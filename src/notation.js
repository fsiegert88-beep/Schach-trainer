// Lernhilfe: erklärt deutsche Schachnotation (z. B. "Sxd6+") in Klartext.

export const PIECES = {
  K: { name: 'König', art: 'der', symbol: '♔' },
  D: { name: 'Dame', art: 'die', symbol: '♕' },
  T: { name: 'Turm', art: 'der', symbol: '♖' },
  L: { name: 'Läufer', art: 'der', symbol: '♗' },
  S: { name: 'Springer', art: 'der', symbol: '♘' },
  '': { name: 'Bauer', art: 'der', symbol: '♙' },
};

const SAN_RE = /^([KDTLS]?)([a-h]?)([1-8]?)(x?)([a-h][1-8])(?:=([DTLS]))?([+#]?)$/;
const CASTLE_RE = /^(O-O(?:-O)?)([+#]?)$/;

// Zerlegt einen Zug in Teile: [{ text, meaning }] und einen Satz.
// Gibt null zurück, wenn der Text kein Zug ist.
export function explainSan(san) {
  const s = String(san).replace(/[!?]+$/, '');
  const castle = s.match(CASTLE_RE);
  if (castle) {
    const long = castle[1] === 'O-O-O';
    const parts = [{
      text: castle[1],
      meaning: long ? 'lange Rochade (zur Damenseite)' : 'kurze Rochade (zur Königsseite)',
    }];
    let sentence = long
      ? 'Lange Rochade: Der König zieht zwei Felder Richtung Dame (nach c1/c8), der Turm springt über ihn auf d1/d8'
      : 'Kurze Rochade: Der König zieht zwei Felder Richtung Turm (nach g1/g8), der Turm springt über ihn auf f1/f8';
    sentence += suffix(castle[2], parts);
    return { san: s, parts, sentence: sentence + '.' };
  }

  const m = s.match(SAN_RE);
  if (!m) return null;
  const [, letter, fromFile, fromRank, capture, to, promo, check] = m;
  const piece = PIECES[letter];
  const parts = [];
  parts.push(letter
    ? { text: letter, meaning: `${piece.symbol} ${piece.name}` }
    : { text: '', meaning: `${piece.symbol} Bauer (Bauernzüge haben keinen Buchstaben)` });

  let who = piece.name;
  if (fromFile || fromRank) {
    const from = fromFile + fromRank;
    const where = fromFile && fromRank ? `vom Feld ${from}` : fromFile ? `von der ${fromFile}-Linie` : `von der ${fromRank}. Reihe`;
    parts.push({
      text: from,
      meaning: letter
        ? `Herkunft: ${where} (zwei gleiche Figuren könnten dorthin)`
        : `Herkunft: ${where}`,
    });
    who += ` ${where}`;
  }
  if (capture) parts.push({ text: 'x', meaning: 'schlägt eine Figur' });
  parts.push({ text: to, meaning: `Zielfeld: Linie ${to[0]}, Reihe ${to[1]}` });

  let sentence = capture ? `${who} schlägt auf ${to}` : `${who} zieht nach ${to}`;
  if (promo) {
    const p = PIECES[promo];
    parts.push({ text: `=${promo}`, meaning: `Umwandlung in ${p.symbol} ${p.name}` });
    sentence += ` und wird ${p.art === 'die' ? 'zur' : 'zum'} ${p.name}`;
  }
  sentence += suffix(check, parts);
  return { san: s, parts, sentence: `${capitalize(sentence)}.` };
}

function suffix(mark, parts) {
  if (mark === '+') {
    parts.push({ text: '+', meaning: 'Schach (König wird angegriffen)' });
    return ' und gibt Schach';
  }
  if (mark === '#') {
    parts.push({ text: '#', meaning: 'Schachmatt – Partie vorbei' });
    return ' und setzt matt';
  }
  return '';
}

function capitalize(s) {
  return s[0].toUpperCase() + s.slice(1);
}

// Findet Züge in einem Fließtext, die eindeutig Notation sind (mit Figurbuchstabe,
// x, +, # oder Rochade). Reine Felder wie "e5" bleiben unberührt.
// Ohne Lookbehind, weil ältere Safari-Versionen das nicht können.
const SAN_IN_TEXT = /(^|[^\wäöüÄÖÜß])(O-O(?:-O)?[+#]?|[KDTLS][a-h]?[1-8]?x?[a-h][1-8][+#]?|[a-h]x[a-h][1-8](?:=[DTLS])?[+#]?|[a-h][1-8](?:=[DTLS])[+#]?|[a-h][1-8][+#])(?=$|[^\wäöüÄÖÜß])/g;

// Ersetzt erkannte Züge in (bereits HTML-escaptem) Text mittels wrap(san).
export function markMoves(html, wrap) {
  return html.replace(SAN_IN_TEXT, (_, pre, san) => pre + wrap(san));
}
