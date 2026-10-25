import { Chess } from 'chess.js';
import { Chessground } from '@lichess-org/chessground';
import { Engine, winChance } from './engine.js';
import { reviewMove, CLASS_INFO, sanDE, uciToMove } from './coach.js';

const LEVELS = [
  { name: 'Einsteiger', skill: 0, depth: 1, movetime: 150 },
  { name: 'Anfänger', skill: 3, depth: 2, movetime: 300 },
  { name: 'Gelegenheitsspieler', skill: 6, depth: 4, movetime: 400 },
  { name: 'Vereinsspieler', skill: 9, depth: 6, movetime: 600 },
  { name: 'Fortgeschritten', skill: 12, depth: 8, movetime: 800 },
  { name: 'Stark', skill: 16, depth: 12, movetime: 1000 },
  { name: 'Meister', skill: 20, depth: 18, movetime: 1500 },
];
const ANALYSIS = { depth: 15, movetime: 1200 };
const STORE_KEY = 'schach-trainer-v1';

const $ = (sel) => document.querySelector(sel);
const el = {
  board: $('#board'),
  status: $('#status'),
  evalFill: $('#eval-fill'),
  evalText: $('#eval-text'),
  coach: $('#coach'),
  moves: $('#moves'),
  undo: $('#btn-undo'),
  hint: $('#btn-hint'),
  newBtn: $('#btn-new'),
  dialog: $('#new-game'),
  promo: $('#promo'),
};

let settings = { color: 'w', level: 3, pause: true };
let game = new Chess();
let records = []; // { san, uci, color, fenBefore, fenAfter, review }
let userColor = 'w';
let busy = false;
let gen = 0; // erhöht sich bei Rücknahme/Neustart -> veraltete Ergebnisse verwerfen
let pendingBefore = null; // { fen, promise }
let viewPly = null; // angezeigter Zug im Rückblick (Index) oder null = live
let viewBetter = false;
let lastEvalWhite = 0;

let analyser;
let player;
try {
  analyser = new Engine();
  player = new Engine();
} catch (e) {
  setStatus('Engine konnte nicht geladen werden: ' + e.message);
}

const cg = Chessground(el.board, {
  coordinates: true,
  animation: { duration: 200 },
  movable: { free: false, showDests: true, events: { after: onUserMove } },
  premovable: { enabled: false },
  draggable: { showGhost: true },
  highlight: { lastMove: true, check: true },
  drawable: { enabled: false, visible: true },
});

function color(c) {
  return c === 'w' ? 'white' : 'black';
}

function dests(chess) {
  const map = new Map();
  for (const m of chess.moves({ verbose: true })) {
    if (!map.has(m.from)) map.set(m.from, []);
    map.get(m.from).push(m.to);
  }
  return map;
}

function setStatus(text) {
  el.status.textContent = text;
}

function userTurn() {
  return !game.isGameOver() && game.turn() === userColor;
}

function syncBoard() {
  const last = records[records.length - 1];
  const live = viewPly === null;
  if (live) {
    cg.set({
      fen: game.fen(),
      orientation: color(userColor),
      turnColor: color(game.turn()),
      lastMove: last ? [last.uci.slice(0, 2), last.uci.slice(2, 4)] : undefined,
      check: game.inCheck(),
      movable: {
        color: userTurn() && !busy ? color(userColor) : undefined,
        dests: userTurn() && !busy ? dests(game) : new Map(),
      },
    });
    const shapes = [];
    if (last?.review && isBad(last.review)) addReviewShapes(shapes, last, false);
    cg.setAutoShapes(shapes);
  } else {
    const r = records[viewPly];
    const showBefore = viewBetter && r.review;
    const fen = showBefore ? r.fenBefore : r.fenAfter;
    const chess = new Chess(fen);
    cg.set({
      fen,
      orientation: color(userColor),
      turnColor: color(chess.turn()),
      lastMove: showBefore ? undefined : [r.uci.slice(0, 2), r.uci.slice(2, 4)],
      check: chess.inCheck(),
      movable: { color: undefined, dests: new Map() },
    });
    const shapes = [];
    if (r.review) addReviewShapes(shapes, r, showBefore);
    cg.setAutoShapes(shapes);
  }
  el.undo.disabled = busy || !records.some((r) => r.color === userColor);
  el.hint.disabled = busy || !userTurn() || viewPly !== null;
}

function addReviewShapes(shapes, r, showBefore) {
  const rv = r.review;
  if (showBefore) {
    if (rv.bestUci) shapes.push({ orig: rv.bestUci.slice(0, 2), dest: rv.bestUci.slice(2, 4), brush: 'green' });
    if (r.uci !== rv.bestUci) shapes.push({ orig: r.uci.slice(0, 2), dest: r.uci.slice(2, 4), brush: 'red' });
  } else if (isBad(rv) && rv.refUci) {
    shapes.push({ orig: rv.refUci.slice(0, 2), dest: rv.refUci.slice(2, 4), brush: 'red' });
  }
}

function isBad(rv) {
  return ['inaccuracy', 'mistake', 'blunder'].includes(rv.cls);
}

function setEval(cpWhite) {
  lastEvalWhite = cpWhite;
  const userCp = userColor === 'w' ? cpWhite : -cpWhite;
  const pct = winChance(userCp) * 100;
  el.evalFill.style.width = `${pct}%`;
  let txt;
  if (Math.abs(userCp) >= 9000) txt = userCp > 0 ? 'Du setzt matt' : 'Gegner setzt matt';
  else {
    const v = (userCp / 100).toFixed(1).replace('.', ',');
    txt = userCp > 0 ? `+${v}` : v;
  }
  el.evalText.textContent = txt;
}

// ---------- Ablauf ----------

function startBeforeAnalysis() {
  if (!userTurn() || !analyser) return;
  const fen = game.fen();
  if (pendingBefore?.fen === fen) return;
  pendingBefore = { fen, promise: analyser.analyse(fen, ANALYSIS) };
}

async function onUserMove(orig, dest) {
  const piece = game.get(orig);
  let promotion;
  if (piece?.type === 'p' && (dest[1] === '8' || dest[1] === '1')) {
    promotion = await askPromotion();
  }
  let move;
  try {
    move = game.move({ from: orig, to: dest, promotion });
  } catch {
    syncBoard();
    return;
  }
  const myGen = gen;
  const fenBefore = move.before;
  const rec = { san: move.san, uci: move.from + move.to + (move.promotion || ''), color: move.color, fenBefore, fenAfter: move.after, review: null };
  records.push(rec);
  viewPly = null;
  busy = true;
  syncBoard();
  renderMoves();
  save();
  showCoachThinking();
  setStatus('Analysiere deinen Zug …');

  const beforeP = pendingBefore?.fen === fenBefore ? pendingBefore.promise : analyser.analyse(fenBefore, ANALYSIS);
  const afterP = game.isGameOver() ? Promise.resolve({ lines: [], bestmove: null }) : analyser.analyse(move.after, ANALYSIS);
  // Der Gegner rechnet schon parallel.
  const replyP = game.isGameOver() ? null : enginePick(move.after);

  const [before, after] = await Promise.all([beforeP, afterP]);
  if (myGen !== gen) return;
  rec.review = reviewMove({ fenBefore, move, before, after });
  setEval(rec.review.cpAfterWhite);
  renderMoves();
  save();

  if (game.isGameOver()) {
    busy = false;
    showCoach(rec, { final: true });
    finishGame();
    return;
  }

  const serious = rec.review.cls === 'mistake' || rec.review.cls === 'blunder';
  if (settings.pause && serious) {
    busy = false;
    syncBoard();
    cg.set({ movable: { color: undefined, dests: new Map() } });
    showCoach(rec, { pause: true, onContinue: () => playReply(replyP, myGen) });
    setStatus('Schau dir die Erklärung an – zurücknehmen oder weiterspielen?');
    return;
  }
  showCoach(rec);
  await playReply(replyP, myGen);
}

function enginePick(fen) {
  const lv = LEVELS[settings.level - 1];
  const started = Date.now();
  return player.analyse(fen, { depth: lv.depth, movetime: lv.movetime }).then(async (res) => {
    const wait = 450 - (Date.now() - started);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    return res.bestmove;
  });
}

async function playReply(replyP, myGen) {
  busy = true;
  syncBoard();
  setStatus('Gegner überlegt …');
  const uci = await (replyP || enginePick(game.fen()));
  if (myGen !== gen || !uci) {
    if (myGen === gen) busy = false;
    return;
  }
  const move = game.move(uciToMove(uci));
  records.push({ san: move.san, uci, color: move.color, fenBefore: move.before, fenAfter: move.after, review: null });
  busy = false;
  viewPly = null;
  syncBoard();
  renderMoves();
  save();
  if (game.isGameOver()) {
    finishGame();
    return;
  }
  setStatus(game.inCheck() ? 'Schach! Du bist am Zug.' : 'Du bist am Zug.');
  startBeforeAnalysis();
}

function takeBack() {
  if (busy) return;
  gen++;
  // bis vor den letzten eigenen Zug zurück
  while (records.length) {
    const r = records.pop();
    game.undo();
    if (r.color === userColor) break;
  }
  viewPly = null;
  pendingBefore = null;
  const last = [...records].reverse().find((r) => r.review);
  if (last) setEval(last.review.cpAfterWhite);
  else setEval(0);
  hideCoach();
  syncBoard();
  renderMoves();
  save();
  setStatus('Zug zurückgenommen. Du bist am Zug.');
  startBeforeAnalysis();
}

async function showHint() {
  if (!userTurn() || busy) return;
  startBeforeAnalysis();
  setStatus('Suche einen guten Zug …');
  const myGen = gen;
  const fen = game.fen();
  const res = await pendingBefore.promise;
  if (myGen !== gen || game.fen() !== fen || !res.bestmove) return;
  const piece = game.get(res.bestmove.slice(0, 2));
  cg.setAutoShapes([{ orig: res.bestmove.slice(0, 2), brush: 'green' }]);
  const names = { p: 'deinen Bauern', n: 'deinen Springer', b: 'deinen Läufer', r: 'deinen Turm', q: 'deine Dame', k: 'deinen König' };
  setStatus(`Tipp: Schau dir ${names[piece.type]} auf ${res.bestmove.slice(0, 2)} an.`);
}

function finishGame() {
  busy = false;
  syncBoard();
  let result;
  if (game.isCheckmate()) result = game.turn() === userColor ? 'Schachmatt – der Gegner hat gewonnen.' : 'Schachmatt – du hast gewonnen! 🎉';
  else if (game.isStalemate()) result = 'Patt – Remis.';
  else if (game.isThreefoldRepetition()) result = 'Remis durch dreifache Stellungswiederholung.';
  else if (game.isInsufficientMaterial()) result = 'Remis – zu wenig Material zum Mattsetzen.';
  else result = 'Remis.';
  setStatus(result);
  showSummary(result);
}

// ---------- Coach-Anzeige ----------

function hideCoach() {
  el.coach.hidden = true;
  el.coach.innerHTML = '';
}

function showCoachThinking() {
  el.coach.hidden = false;
  el.coach.className = 'coach thinking';
  el.coach.innerHTML = '<div class="coach-head"><span class="spinner"></span> Analysiere …</div>';
}

function showCoach(rec, { pause = false, onContinue = null, review = false } = {}) {
  const rv = rec.review;
  if (!rv) return hideCoach();
  const info = CLASS_INFO[rv.cls];
  el.coach.hidden = false;
  el.coach.className = `coach cls-${rv.cls}`;
  const bad = isBad(rv);
  let html = `<div class="coach-head"><span class="badge">${info.icon}</span><span class="title">${sanDE(rec.san)} · ${info.label}</span></div>`;
  html += `<div class="coach-body">${rv.text.map((t) => `<p>${esc(t)}</p>`).join('')}</div>`;
  if (bad && rv.bestSan) {
    html += `<div class="coach-lines"><div><span class="lbl good">Besser:</span> ${esc(rv.bestLine.slice(0, 6).join(' '))}</div>`;
    if (rv.refLine.length) html += `<div><span class="lbl bad">Nach deinem Zug:</span> ${esc(rv.refLine.slice(0, 6).join(' '))}</div>`;
    html += '</div>';
  }
  html += '<div class="coach-actions">';
  if (bad && rv.bestSan) html += `<button data-act="better" class="secondary">${viewBetter && viewPly !== null ? 'Partiestellung' : 'Besseren Zug zeigen'}</button>`;
  if (pause) {
    html += '<button data-act="undo" class="primary">Zurücknehmen</button>';
    html += '<button data-act="continue" class="secondary">Weiterspielen</button>';
  }
  if (review) html += '<button data-act="live" class="secondary">Zurück zur Partie</button>';
  html += '</div>';
  el.coach.innerHTML = html;
  el.coach.querySelector('[data-act="undo"]')?.addEventListener('click', takeBack);
  el.coach.querySelector('[data-act="continue"]')?.addEventListener('click', () => {
    viewPly = null;
    viewBetter = false;
    showCoach(rec);
    onContinue?.();
  });
  el.coach.querySelector('[data-act="live"]')?.addEventListener('click', () => {
    viewPly = null;
    viewBetter = false;
    syncBoard();
    renderMoves();
    showCoach(records[records.length - 1]?.review ? records[records.length - 1] : lastUserRecord() || {}, {});
    if (!records.length) hideCoach();
  });
  el.coach.querySelector('[data-act="better"]')?.addEventListener('click', () => {
    const idx = records.indexOf(rec);
    if (viewPly === idx && viewBetter) {
      viewBetter = false;
      viewPly = pause || idx === records.length - 1 ? null : idx;
    } else {
      viewPly = idx;
      viewBetter = true;
    }
    syncBoard();
    renderMoves();
    showCoach(rec, { pause, onContinue, review: viewPly !== null && !pause });
    if (pause && viewPly !== null) {
      el.coach.querySelector('[data-act="better"]').textContent = 'Partiestellung';
    }
  });
}

function lastUserRecord() {
  return [...records].reverse().find((r) => r.review);
}

function showSummary(result) {
  const counts = { blunder: 0, mistake: 0, inaccuracy: 0, best: 0, good: 0, ok: 0 };
  for (const r of records) if (r.review) counts[r.review.cls]++;
  const last = records[records.length - 1];
  el.coach.hidden = false;
  el.coach.className = 'coach summary';
  el.coach.innerHTML = `
    <div class="coach-head"><span class="title">${esc(result)}</span></div>
    ${last?.review ? `<div class="coach-body"><p><b>${sanDE(last.san)}:</b> ${esc(last.review.text.join(' '))}</p></div>` : ''}
    <div class="stats">
      <div class="stat cls-best"><b>${counts.best}</b>Beste</div>
      <div class="stat cls-good"><b>${counts.good + counts.ok}</b>Gut</div>
      <div class="stat cls-inaccuracy"><b>${counts.inaccuracy}</b>Ungenau</div>
      <div class="stat cls-mistake"><b>${counts.mistake}</b>Fehler</div>
      <div class="stat cls-blunder"><b>${counts.blunder}</b>Patzer</div>
    </div>
    <p class="hint">Tippe unten auf einen deiner Züge, um ihn noch einmal anzusehen.</p>
    <div class="coach-actions"><button class="primary" data-act="new">Neue Partie</button></div>`;
  el.coach.querySelector('[data-act="new"]').addEventListener('click', openNewGame);
}

function renderMoves() {
  const parts = [];
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    const ply = i + (game.history().length === records.length ? 0 : 0);
    const startBlack = records[0] && new Chess(records[0].fenBefore).turn() === 'b';
    const moveNo = Math.floor((i + (startBlack ? 1 : 0)) / 2) + 1;
    if (r.color === 'w' || i === 0) parts.push(`<span class="no">${moveNo}.${r.color === 'b' ? '…' : ''}</span>`);
    const cls = r.review ? `mv cls-${r.review.cls}` : 'mv';
    const mark = r.review && CLASS_INFO[r.review.cls].icon.includes('?') ? `<sup>${CLASS_INFO[r.review.cls].icon}</sup>` : '';
    const sel = viewPly === i ? ' sel' : '';
    parts.push(`<button class="${cls}${sel}" data-i="${ply}">${esc(sanDE(r.san))}${mark}</button>`);
  }
  el.moves.innerHTML = parts.join('') || '<span class="empty">Noch keine Züge.</span>';
  el.moves.scrollLeft = el.moves.scrollWidth;
}

el.moves.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-i]');
  if (!b || busy) return;
  const i = Number(b.dataset.i);
  const live = i === records.length - 1 && !game.isGameOver();
  viewPly = live ? null : i;
  viewBetter = false;
  syncBoard();
  renderMoves();
  const r = records[i];
  if (r.review) showCoach(r, { review: viewPly !== null });
  else if (viewPly !== null) {
    el.coach.hidden = false;
    el.coach.className = 'coach';
    el.coach.innerHTML = `<div class="coach-head"><span class="title">${esc(sanDE(r.san))} · Zug des Gegners</span></div><div class="coach-actions"><button data-act="live" class="secondary">Zurück zur Partie</button></div>`;
    el.coach.querySelector('[data-act="live"]').addEventListener('click', () => {
      viewPly = null;
      syncBoard();
      renderMoves();
      hideCoach();
    });
  }
});

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

// ---------- Umwandlung ----------

function askPromotion() {
  return new Promise((resolve) => {
    el.promo.hidden = false;
    el.promo.onclick = (e) => {
      const b = e.target.closest('button[data-p]');
      if (!b) return;
      el.promo.hidden = true;
      resolve(b.dataset.p);
    };
  });
}

// ---------- Neue Partie ----------

function openNewGame() {
  const f = el.dialog.querySelector('form');
  f.color.value = settings.color;
  f.level.value = settings.level;
  f.pause.checked = settings.pause;
  updateLevelLabel();
  el.dialog.showModal();
}

function updateLevelLabel() {
  const f = el.dialog.querySelector('form');
  $('#level-name').textContent = `Stufe ${f.level.value}: ${LEVELS[f.level.value - 1].name}`;
}

el.dialog.querySelector('form').level.addEventListener('input', updateLevelLabel);
el.dialog.querySelector('form').addEventListener('submit', (e) => {
  const f = e.target;
  if (e.submitter?.value !== 'start') return;
  settings = { color: f.color.value, level: Number(f.level.value), pause: f.pause.checked };
  newGame();
});

async function newGame() {
  gen++;
  game = new Chess();
  records = [];
  viewPly = null;
  viewBetter = false;
  pendingBefore = null;
  userColor = settings.color === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : settings.color;
  busy = false;
  hideCoach();
  setEval(0);
  renderMoves();
  syncBoard();
  save();
  const lv = LEVELS[settings.level - 1];
  $('#level-badge').textContent = `Stufe ${settings.level} · ${lv.name}`;
  await player.setOption('Skill Level', lv.skill);
  await player.newGame();
  if (userColor === 'b') {
    await playReply(null, gen);
  } else {
    setStatus('Du spielst Weiß. Du bist am Zug.');
    startBeforeAnalysis();
  }
}

// ---------- Speichern ----------

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ settings, userColor, records, evalWhite: lastEvalWhite }));
  } catch {}
}

async function restore() {
  let data = null;
  try {
    data = JSON.parse(localStorage.getItem(STORE_KEY));
  } catch {}
  if (!data?.settings) return false;
  settings = data.settings;
  userColor = data.userColor || 'w';
  game = new Chess();
  records = [];
  for (const r of data.records || []) {
    try {
      game.move(uciToMove(r.uci));
      records.push(r);
    } catch {
      break;
    }
  }
  const lv = LEVELS[settings.level - 1];
  $('#level-badge').textContent = `Stufe ${settings.level} · ${lv.name}`;
  await player.setOption('Skill Level', lv.skill);
  setEval(data.evalWhite || 0);
  // Falls die App mitten im Gegnerzug geschlossen wurde
  const last = records[records.length - 1];
  if (last && last.color === userColor && !last.review) {
    records.pop();
    game.undo();
  }
  renderMoves();
  syncBoard();
  if (game.isGameOver()) finishGame();
  else if (game.turn() !== userColor) await playReply(null, gen);
  else {
    setStatus('Partie fortgesetzt. Du bist am Zug.');
    if (last?.review) showCoach(lastUserRecord());
    startBeforeAnalysis();
  }
  return true;
}

el.undo.addEventListener('click', takeBack);
el.hint.addEventListener('click', showHint);
el.newBtn.addEventListener('click', openNewGame);

(async () => {
  if (!player) return;
  setStatus('Engine wird geladen …');
  try {
    await Promise.all([player.ready, analyser.ready]);
  } catch (e) {
    setStatus('Engine-Fehler: ' + e.message);
    return;
  }
  if (!(await restore())) {
    $('#level-badge').textContent = `Stufe ${settings.level} · ${LEVELS[settings.level - 1].name}`;
    openNewGame();
    setStatus('Wähle deine Einstellungen für die erste Partie.');
    syncBoard();
  }
})();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// Für automatische Tests
window.__schach = { get game() { return game; }, cg, get busy() { return busy; } };
