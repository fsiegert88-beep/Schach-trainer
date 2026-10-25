// Bewertet Züge und erklärt auf Deutsch, warum ein anderer Zug besser gewesen wäre.
import { Chess } from 'chess.js';
import { scoreToCp, winChance } from './engine.js';

const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const NOUN = { p: 'Bauer', n: 'Springer', b: 'Läufer', r: 'Turm', q: 'Dame', k: 'König' };
const FEM = { q: true };
const ART = {
  def: { nom: ['der', 'die'], akk: ['den', 'die'], dat: ['dem', 'der'] },
  my: { nom: ['dein', 'deine'], akk: ['deinen', 'deine'], dat: ['deinem', 'deiner'] },
  opp: {
    nom: ['der gegnerische', 'die gegnerische'],
    akk: ['den gegnerischen', 'die gegnerische'],
    dat: ['dem gegnerischen', 'der gegnerischen'],
  },
};

// Nominalphrase, z. B. np('n','akk','my') -> "deinen Springer"
export function np(type, kasus = 'nom', owner = 'def') {
  const art = ART[owner][kasus][FEM[type] ? 1 : 0];
  let noun = NOUN[type];
  if (type === 'p' && kasus !== 'nom') noun = 'Bauern';
  return `${art} ${noun}`;
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// Englische Kurznotation -> deutsche (S, L, T, D, K)
export function sanDE(san) {
  return san.replace(/[NBRQ]/g, (c) => ({ N: 'S', B: 'L', R: 'T', Q: 'D' })[c]);
}

export function uciToMove(uci) {
  return { from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined };
}

function tryMove(chess, uci) {
  try {
    return chess.move(uciToMove(uci));
  } catch {
    return null;
  }
}

function material(chess, color) {
  let sum = 0;
  for (const row of chess.board()) {
    for (const p of row) {
      if (!p) continue;
      sum += p.color === color ? VAL[p.type] : -VAL[p.type];
    }
  }
  return sum;
}

// Spielt eine Hauptvariante nach und liefert Züge, Notation und Material.
export function playLine(fen, pv, maxPlies = 10) {
  const chess = new Chess(fen);
  const moves = [];
  for (const uci of pv.slice(0, maxPlies)) {
    const m = tryMove(chess, uci);
    if (!m) break;
    moves.push(m);
  }
  return { moves, sans: moves.map((m) => sanDE(m.san)), end: chess };
}

// Materialbilanz (aus Sicht von pov) an einem ruhigen Punkt der Variante.
function quietMaterial(fen, pv, pov, maxPlies = 6) {
  const chess = new Chess(fen);
  const seq = [material(chess, pov)];
  const moves = [];
  for (const uci of pv.slice(0, maxPlies + 2)) {
    const m = tryMove(chess, uci);
    if (!m) break;
    moves.push(m);
    seq.push(material(chess, pov));
  }
  let best = 0;
  for (let i = 1; i <= Math.min(maxPlies, moves.length); i++) {
    const next = moves[i];
    if (!next || !next.captured) best = i;
  }
  if (best === 0) best = Math.min(maxPlies, moves.length);
  return { value: seq[best], moves: moves.slice(0, best) };
}

function isUndefended(chess, sq) {
  const p = chess.get(sq);
  return p ? chess.attackers(sq, p.color).length === 0 : false;
}

function cheapestAttacker(chess, sq, color) {
  let min = Infinity;
  let type = null;
  for (const a of chess.attackers(sq, color)) {
    const p = chess.get(a);
    const v = p.type === 'k' ? 100 : VAL[p.type];
    if (v < min) {
      min = v;
      type = p.type;
    }
  }
  return type;
}

function allSquares() {
  const out = [];
  for (const f of 'abcdefgh') for (const r of '12345678') out.push(f + r);
  return out;
}
const SQUARES = allSquares();

// Figuren, die die Figur auf sq gleichzeitig sinnvoll angreift (Gabel).
function forkTargets(chess, sq) {
  const me = chess.get(sq);
  if (!me) return [];
  const targets = [];
  for (const t of SQUARES) {
    const p = chess.get(t);
    if (!p || p.color === me.color) continue;
    if (!chess.attackers(t, me.color).includes(sq)) continue;
    if (p.type === 'k' || VAL[p.type] > VAL[me.type] || isUndefended(chess, t)) {
      targets.push({ sq: t, type: p.type });
    }
  }
  // Mindestens ein Ziel muss mehr als ein Bauer sein
  if (!targets.some((t) => t.type !== 'p')) return [];
  return targets.length >= 2 ? targets : [];
}

// Wertvollste Figur, die der Zug auf sq direkt angreift (Angriff mit Tempo)
function attackedValuable(chess, sq) {
  const me = chess.get(sq);
  if (!me) return null;
  let best = null;
  for (const t of SQUARES) {
    const p = chess.get(t);
    if (!p || p.color === me.color || p.type === 'k') continue;
    if (!chess.attackers(t, me.color).includes(sq)) continue;
    if (VAL[p.type] > VAL[me.type] && (!best || VAL[p.type] > VAL[best.type])) best = { sq: t, type: p.type };
  }
  return best;
}

const DIRS = {
  b: [[1, 1], [1, -1], [-1, 1], [-1, -1]],
  r: [[1, 0], [-1, 0], [0, 1], [0, -1]],
};
DIRS.q = [...DIRS.b, ...DIRS.r];

// Fesselung oder Spieß durch die Langschrittler-Figur auf sq.
function lineTactic(chess, sq) {
  const me = chess.get(sq);
  if (!me || !DIRS[me.type]) return null;
  const f0 = sq.charCodeAt(0) - 97;
  const r0 = Number(sq[1]) - 1;
  for (const [df, dr] of DIRS[me.type]) {
    const hit = [];
    let f = f0 + df;
    let r = r0 + dr;
    while (f >= 0 && f < 8 && r >= 0 && r < 8 && hit.length < 2) {
      const s = String.fromCharCode(97 + f) + (r + 1);
      const p = chess.get(s);
      if (p) hit.push({ sq: s, type: p.type, color: p.color });
      f += df;
      r += dr;
    }
    if (hit.length < 2) continue;
    const [a, b] = hit;
    if (a.color === me.color || b.color === me.color) continue;
    const va = a.type === 'k' ? 100 : VAL[a.type];
    const vb = b.type === 'k' ? 100 : VAL[b.type];
    if (vb > va && va < VAL[me.type] + 3) return { kind: 'pin', front: a, back: b };
    if (va > vb && va > VAL[me.type]) return { kind: 'skewer', front: a, back: b };
  }
  return null;
}

function listTargets(targets, owner) {
  const parts = targets.map((t) => `${np(t.type, 'akk', owner)} auf ${t.sq}`);
  if (parts.length === 1) return parts[0];
  return parts.slice(0, -1).join(', ') + ' und ' + parts[parts.length - 1];
}

function fmtEval(cpUser, mateUser) {
  if (mateUser) return mateUser > 0 ? `Matt in ${mateUser}` : `Gegner setzt matt in ${-mateUser}`;
  const v = (cpUser / 100).toFixed(1).replace('.', ',');
  return cpUser > 0 ? `+${v}` : v;
}

function plural(n, one, many) {
  return n === 1 ? `${n} ${one}` : `${n} ${many}`;
}

export const CLASS_INFO = {
  best: { label: 'Bester Zug', icon: '★' },
  good: { label: 'Guter Zug', icon: '✓' },
  ok: { label: 'Okay', icon: '•' },
  inaccuracy: { label: 'Ungenauigkeit', icon: '?!' },
  mistake: { label: 'Fehler', icon: '?' },
  blunder: { label: 'Patzer', icon: '??' },
};

// Hauptfunktion: vergleicht den gespielten Zug mit dem besten Zug der Engine.
export function reviewMove({ fenBefore, move, before, after }) {
  const user = move.color;
  const opp = user === 'w' ? 'b' : 'w';
  const s = user === 'w' ? 1 : -1;
  const fenAfter = move.after;
  const posAfter = new Chess(fenAfter);

  const bestLine = before.lines[0] || {};
  const bestUci = before.bestmove;
  const userUci = move.from + move.to + (move.promotion || '');

  // Bewertung nach dem Zug (bei Spielende ohne Engine).
  let afterLine = after?.lines?.[0] || {};
  if (posAfter.isCheckmate()) afterLine = { mate: s * 0.5, cp: null, pv: [] };
  else if (posAfter.isDraw()) afterLine = { cp: 0, mate: null, pv: [] };

  const cpBefore = s * scoreToCp(bestLine);
  const cpAfter = posAfter.isCheckmate() ? 10000 : s * scoreToCp(afterLine);
  const drop = winChance(cpBefore) - winChance(cpAfter);

  const mateBefore = bestLine.mate ? s * bestLine.mate : null;
  const mateAfter = posAfter.isCheckmate() ? null : afterLine.mate ? s * afterLine.mate : null;

  let cls;
  if (userUci === bestUci || posAfter.isCheckmate()) cls = 'best';
  else if (drop < 0.02) cls = 'good';
  else if (drop < 0.05) cls = 'ok';
  else if (drop < 0.1) cls = 'inaccuracy';
  else if (drop < 0.15) cls = 'mistake';
  else cls = 'blunder';

  // Verpasstes kurzes Matt ist immer erwähnenswert.
  if (mateBefore > 0 && mateBefore <= 3 && !(mateAfter > 0) && !posAfter.isCheckmate()) {
    if (cls === 'best' || cls === 'good' || cls === 'ok') cls = 'inaccuracy';
  }

  const best = bestUci ? playLine(fenBefore, bestLine.pv?.length ? bestLine.pv : [bestUci], 8) : null;
  const refutation = afterLine.pv?.length ? playLine(fenAfter, afterLine.pv, 8) : null;

  const result = {
    cls,
    san: sanDE(move.san),
    bestUci,
    bestSan: best?.sans[0] || null,
    bestLine: best?.sans || [],
    refUci: afterLine.pv?.[0] || null,
    refLine: refutation?.sans || [],
    evalBefore: fmtEval(cpBefore, mateBefore),
    evalAfter: posAfter.isCheckmate() ? 'Matt' : fmtEval(cpAfter, mateAfter),
    cpAfterWhite: posAfter.isCheckmate() ? s * 10000 : scoreToCp(afterLine),
    drop,
    text: [],
  };

  if (cls === 'best') {
    result.text.push(posAfter.isCheckmate() ? 'Schachmatt – sehr gut!' : praise(fenBefore, move));
    return result;
  }
  if (cls === 'good' || cls === 'ok') {
    result.text.push(
      cls === 'good'
        ? 'Solider Zug, die Stellung bleibt etwa gleich gut.'
        : `Spielbar, aber ${result.bestSan} war etwas genauer.`
    );
    return result;
  }

  result.text = explain({
    fenBefore, fenAfter, move, user, opp, best, refutation,
    bestLine, afterLine, mateBefore, mateAfter, cpBefore, cpAfter, posAfter,
  });
  return result;
}

function praise(fenBefore, move) {
  const chess = new Chess(move.after);
  const fork = forkTargets(chess, move.to);
  if (move.captured && isUndefendedBefore(fenBefore, move.to)) return 'Bester Zug – du schnappst dir eine ungedeckte Figur.';
  if (fork.length) return `Bester Zug – eine Gabel gegen ${listTargets(fork, 'opp')}!`;
  if (move.san.includes('O-O')) return 'Bester Zug – die Rochade bringt deinen König in Sicherheit.';
  return 'Bester Zug – genau das hätte auch die Engine gespielt.';
}

function isUndefendedBefore(fen, sq) {
  return isUndefended(new Chess(fen), sq);
}

function explain(c) {
  const { fenBefore, fenAfter, move, user, opp, best, refutation, bestLine, afterLine } = c;
  const out = [];
  const san = sanDE(move.san);
  const bestSan = best?.sans[0];

  // 1) Patt trotz Vorteil
  if (c.posAfter.isStalemate()) {
    out.push(`Achtung, ${san} ist Patt! Der Gegner hat keinen legalen Zug mehr, aber steht nicht im Schach – die Partie endet remis, obwohl du klar besser standest.`);
    if (bestSan) out.push(bestSan.includes('#') ? `Mit ${bestSan} hättest du sofort mattgesetzt.` : `Mit ${bestSan} hättest du weiter auf Gewinn spielen können.`);
    return out;
  }

  // 2) Gegner kann mattsetzen
  if (c.mateAfter !== null && c.mateAfter < 0) {
    const n = -c.mateAfter;
    const line = refutation?.sans.slice(0, n * 2 - 1).join(' ') || '';
    out.push(`Nach ${san} kann der Gegner ${n === 1 ? 'sofort' : `in ${n} Zügen`} mattsetzen: ${line}.`);
    const mating = refutation?.moves[n * 2 - 2];
    if (mating && backRankMate(refutation.end, user)) {
      out.push('Das ist ein Grundreihenmatt: Dein König ist hinter den eigenen Bauern eingesperrt. Ein „Luftloch“ (z. B. h3/h6) hätte das verhindert.');
    }
    if (bestSan && !(c.mateBefore !== null && c.mateBefore < 0)) out.push(`Mit ${bestSan} wäre das nicht passiert.`);
    return out;
  }

  // 3) Eigenes Matt verpasst
  if (c.mateBefore > 0 && !(c.mateAfter > 0 && c.mateAfter <= c.mateBefore)) {
    const n = c.mateBefore;
    out.push(`Du hattest ${n === 1 ? 'ein Matt in einem Zug' : `ein Matt in ${n} Zügen`}: ${best.sans.slice(0, n * 2 - 1).join(' ')}.`);
    if (best.moves[0]?.san.includes('+')) out.push('Tipp: Prüfe in jeder Stellung zuerst alle Schachgebote – oft steckt dort eine Kombination.');
    return out;
  }

  const matB = material(new Chess(fenBefore), user);
  const userLine = refutation ? quietMaterial(fenAfter, afterLine.pv, user) : { value: material(c.posAfter, user), moves: [] };
  const bestQ = best ? quietMaterial(fenBefore, bestLine.pv?.length ? bestLine.pv : [best.moves[0]?.lan], user) : { value: matB, moves: [] };
  const userDelta = userLine.value - matB;
  const bestDelta = bestQ.value - matB;

  // 4) Material geht verloren
  if (userDelta <= -1 && bestDelta - userDelta >= 1) {
    out.push(...explainLoss(c, userLine.moves, userDelta));
    const why = bestMoveReason(fenBefore, best, bestDelta);
    if (bestSan) out.push(why ? `Besser war ${bestSan}: ${why}` : `Besser war ${bestSan}.`);
    return out;
  }

  // 5) Materialgewinn verpasst
  if (bestDelta >= 1 && bestDelta - userDelta >= 1) {
    out.push(explainMissedGain(fenBefore, best, bestQ.moves, bestDelta));
    return out;
  }

  // 6) Stellungsfehler
  out.push(...explainPositional(c));
  return out;
}

function backRankMate(chess, user) {
  if (!chess.isCheckmate()) return false;
  const [k] = chess.findPiece({ type: 'k', color: user });
  if (!k) return false;
  const back = user === 'w' ? '1' : '8';
  return k[1] === back;
}

function explainLoss(c, lineMoves, delta) {
  const { fenBefore, move, user, opp } = c;
  const out = [];
  const san = sanDE(move.san);
  const r1 = lineMoves[0];
  // Erste Figur des Spielers, die in der Variante geschlagen wird
  const lossMove = lineMoves.find((m) => m.color === opp && m.captured);
  const lostTxt = `(${plural(-delta, 'Bauerneinheit', 'Bauerneinheiten')} Material)`;

  if (!r1) {
    out.push(`Mit ${san} verlierst du Material ${lostTxt}.`);
    return out;
  }
  const r1san = sanDE(r1.san);
  const afterChess = new Chess(move.after);
  const reply = new Chess(r1.after);

  if (r1.captured && lossMove === r1) {
    const t = r1.captured;
    const sq = r1.to;
    if (move.captured && sq === move.to) {
      out.push(`Der Schlagzug ${san} geht nicht auf: Der Gegner schlägt mit ${r1san} zurück, und du verlierst mehr, als du gewonnen hast ${lostTxt}.`);
    } else if (sq === move.to) {
      if (isUndefended(afterChess, sq)) {
        out.push(`Auf ${sq} ist ${np(t, 'nom', 'my')} ungedeckt – der Gegner schlägt einfach mit ${r1san}.`);
      } else {
        const att = cheapestAttacker(afterChess, sq, opp);
        out.push(`Auf ${sq} kann ${np(t, 'nom', 'my')} von ${np(att, 'dat', 'opp')} geschlagen werden. Die Deckung reicht nicht, weil ${np(att, 'nom', 'opp')} weniger wert ist – der Tausch ${r1san} kostet dich Material.`);
      }
    } else {
      const defendedBefore = new Chess(fenBefore).attackers(sq, user).includes(move.from);
      const defendedAfter = afterChess.attackers(sq, user).includes(move.to);
      if (defendedBefore && !defendedAfter) {
        out.push(`${san} zieht ${np(move.piece, 'akk', 'my')} weg, der ${np(t, 'akk', 'my')} auf ${sq} gedeckt hat. Jetzt schlägt der Gegner mit ${r1san}.`);
      } else if (threatExisted(fenBefore, r1, opp)) {
        out.push(`Du hast übersehen, dass ${np(t, 'nom', 'my')} auf ${sq} angegriffen war. Dein Zug ändert daran nichts, der Gegner schlägt mit ${r1san}.`);
      } else {
        out.push(`Nach ${san} hängt ${np(t, 'nom', 'my')} auf ${sq}: Der Gegner schlägt mit ${r1san}.`);
      }
    }
    return out;
  }

  // Taktische Antwort des Gegners
  const lostPiece = lossMove ? `${np(lossMove.captured, 'akk', 'my')} auf ${lossMove.to}` : 'Material';
  const fork = forkTargets(reply, r1.to);
  const lt = lineTactic(reply, r1.to);
  const line = lineMoves.map((m) => sanDE(m.san)).join(' ');
  if (r1.captured) {
    out.push(`Nach ${san} gewinnt der Gegner mit ${r1san} Material: ${line} ${lostTxt}.`);
  } else if (fork.length) {
    out.push(`Dein Zug erlaubt eine Gabel: ${r1san} greift gleichzeitig ${listTargets(fork, 'my')} an. Beides kannst du nicht retten (${line}).`);
  } else if (lt?.kind === 'pin') {
    out.push(`Dein Zug erlaubt eine Fesselung: Nach ${r1san} kann ${np(lt.front.type, 'nom', 'my')} auf ${lt.front.sq} nicht weg, weil sonst ${np(lt.back.type, 'nom', 'my')} dahinter fällt. So verlierst du ${lostPiece}.`);
  } else if (lt?.kind === 'skewer') {
    out.push(`Dein Zug erlaubt einen Spieß: ${r1san} greift ${np(lt.front.type, 'akk', 'my')} an, und wenn er ausweicht, fällt ${np(lt.back.type, 'nom', 'my')} dahinter.`);
  } else if (attackedValuable(reply, r1.to)) {
    const t = attackedValuable(reply, r1.to);
    out.push(`Nach ${san} greift der Gegner mit ${r1san} ${np(t.type, 'akk', 'my')} auf ${t.sq} an. Während du darauf reagierst, verlierst du ${lostPiece} (${line}).`);
  } else if (r1.san.includes('+')) {
    out.push(`Nach ${san} kommt ${r1san} mit Schach, und danach verlierst du ${lostPiece} (${line}).`);
  } else {
    out.push(`Nach ${san} hat der Gegner mit ${r1san} eine starke Antwort, und du verlierst ${lostPiece} (${line}).`);
  }
  return out;
}

// Gab es die Drohung schon vor dem Zug? (Gegner am Zug gedacht)
function threatExisted(fenBefore, r1, opp) {
  try {
    const parts = fenBefore.split(' ');
    parts[1] = opp;
    parts[3] = '-';
    const chess = new Chess(parts.join(' '));
    const m = chess.move({ from: r1.from, to: r1.to, promotion: r1.promotion });
    return !!m && m.captured === r1.captured;
  } catch {
    return false;
  }
}

function bestMoveReason(fenBefore, best, bestDelta) {
  if (!best?.moves[0]) return '';
  const b1 = best.moves[0];
  const chess = new Chess(b1.after);
  if (b1.san.includes('O-O')) return 'Die Rochade bringt den König in Sicherheit.';
  if (b1.captured && bestDelta >= 1) return `Damit gewinnst du ${np(b1.captured, 'akk', 'opp')}.`;
  const fork = forkTargets(chess, b1.to);
  if (fork.length && bestDelta >= 1) return `eine Gabel gegen ${listTargets(fork, 'opp')}.`;
  return 'Damit bleibt dein Material sicher.';
}

function explainMissedGain(fenBefore, best, lineMoves, delta) {
  const b1 = best.moves[0];
  const b1san = sanDE(b1.san);
  const line = (lineMoves.length ? lineMoves : best.moves).map((m) => sanDE(m.san)).join(' ');
  const before = new Chess(fenBefore);
  const after = new Chess(b1.after);
  const gain = `(+${plural(delta, 'Bauerneinheit', 'Bauerneinheiten')})`;

  if (b1.captured) {
    if (isUndefended(before, b1.to)) {
      return `Du hättest mit ${b1san} ${np(b1.captured, 'akk', 'opp')} auf ${b1.to} gewinnen können – ${b1.captured === 'q' ? 'sie' : 'er'} war ungedeckt ${gain}.`;
    }
    if (VAL[b1.captured] > VAL[b1.piece]) {
      return `Mit ${b1san} hättest du Material gewonnen: ${cap(np(b1.captured, 'nom', 'opp'))} ist mehr wert als ${np(b1.piece, 'nom', 'my')}, mit dem du schlägst ${gain}.`;
    }
    return `${b1san} hätte Material gewonnen: ${line} ${gain}.`;
  }
  const fork = forkTargets(after, b1.to);
  if (fork.length) {
    return `${b1san} wäre eine Gabel gewesen: ${cap(np(b1.piece, 'nom', 'my'))} greift gleichzeitig ${listTargets(fork, 'opp')} an ${gain}.`;
  }
  const lt = lineTactic(after, b1.to);
  if (lt?.kind === 'pin') {
    return `${b1san} hätte ${np(lt.front.type, 'akk', 'opp')} auf ${lt.front.sq} gefesselt – dahinter steht ${np(lt.back.type, 'nom', 'opp')}. So gewinnst du Material: ${line} ${gain}.`;
  }
  if (lt?.kind === 'skewer') {
    return `${b1san} wäre ein Spieß gewesen: ${cap(np(lt.front.type, 'nom', 'opp'))} muss ausweichen, dann fällt ${np(lt.back.type, 'nom', 'opp')} ${gain}.`;
  }
  if (b1.san.includes('+')) {
    return `${b1san} mit Schach hätte Material gewonnen: ${line} ${gain}.`;
  }
  // Drohung des Gegners abgewehrt bzw. Angriff auf eine Figur
  return `${b1san} hätte Material gewonnen: ${line} ${gain}.`;
}

function explainPositional(c) {
  const { fenBefore, move, user, best, refutation, cpBefore, cpAfter } = c;
  const out = [];
  const san = sanDE(move.san);
  const before = new Chess(fenBefore);
  const fullmove = Number(fenBefore.split(' ')[5]);
  const b1 = best?.moves[0];
  const bestSan = b1 ? sanDE(b1.san) : null;
  const castleRights = before.getCastlingRights(user);
  const [king] = before.findPiece({ type: 'k', color: user });
  const back = user === 'w' ? '1' : '8';

  if (move.piece === 'k' && !move.san.includes('O-O') && (castleRights.k || castleRights.q)) {
    out.push(`Der Königszug ${san} kostet dich das Recht zu rochieren. Der König bleibt in der Mitte und wird leicht zum Angriffsziel.`);
  } else if (move.piece === 'p' && king && king[1] === back && ['g', 'h', 'f'].includes(king[0]) && ['f', 'g', 'h'].includes(move.from[0])) {
    out.push(`${san} schwächt die Bauern vor deinem König. Dadurch entstehen Löcher, die der Gegner für einen Angriff nutzen kann.`);
  } else if (move.piece === 'p' && king && king[1] === back && ['a', 'b', 'c'].includes(king[0]) && ['a', 'b', 'c'].includes(move.from[0])) {
    out.push(`${san} schwächt die Bauern vor deinem König, der dadurch angreifbarer wird.`);
  } else if (move.piece === 'q' && fullmove <= 8 && undevelopedMinors(before, user) >= 2) {
    out.push('Die Dame so früh zu ziehen kostet Zeit: Der Gegner kann sie mit Tempo angreifen und dabei seine Figuren entwickeln.');
  }

  if (b1) {
    if (b1.san.includes('O-O')) {
      out.push(`Besser war die Rochade ${bestSan}: Sie bringt den König in Sicherheit und den Turm ins Spiel.`);
    } else if (fullmove <= 12 && ['n', 'b'].includes(b1.piece) && b1.from[1] === back) {
      out.push(`Besser war ${bestSan}: Damit entwickelst du eine weitere Figur. In der Eröffnung zählt schnelle Entwicklung.`);
    } else if (refutation?.moves[0] && attackedValuable(new Chess(refutation.moves[0].after), refutation.moves[0].to)?.type === 'q') {
      out.push(`Nach deinem Zug kann der Gegner mit ${refutation.sans[0]} deine Dame angreifen und gewinnt dabei Zeit. Besser war ${bestSan}.`);
    } else if (refutation?.moves[0] && threatAfter(refutation)) {
      out.push(`Nach deinem Zug hat der Gegner mit ${refutation.sans[0]} eine starke Antwort. ${bestSan} hätte das verhindert.`);
    } else {
      const idea = best.sans.slice(0, 5).join(' ');
      out.push(`Die Engine bevorzugt ${bestSan} (Idee: ${idea}).`);
    }
  }
  out.push(`Bewertung aus deiner Sicht: vorher ${fmtEval(cpBefore)}, nach deinem Zug ${fmtEval(cpAfter)}.`);
  return out;
}

function undevelopedMinors(chess, color) {
  const back = color === 'w' ? '1' : '8';
  const home = ['b', 'c', 'f', 'g'].map((f) => f + back);
  return home.filter((sq) => {
    const p = chess.get(sq);
    return p && p.color === color && (p.type === 'n' || p.type === 'b');
  }).length;
}

function threatAfter(refutation) {
  const m = refutation.moves[0];
  return m.captured || m.san.includes('+') || forkTargets(new Chess(m.after), m.to).length > 0;
}
