import { Chess } from 'chess.js';
import { Engine } from '../src/engine.js';
import { reviewMove } from '../src/coach.js';

// [Beschreibung, FEN, Zug]
const CASES = [
  ['Figur einstellen', 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3', 'Nxe5'],
  ['Dame hängt', 'rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2', 'Qg4'],
  ['Gabel erlauben', 'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4', 'd3'],
  ['Gabel verpasst', 'r3k3/8/8/8/8/8/2N5/4K3 w - - 0 1', 'Ke2'],
  ['Matt verpasst', '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1', 'Kf1'],
  ['Grundreihe', '3r2k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1', 'Ra7'],
  ['Deckung weg', 'rnbqkb1r/pppp1ppp/5n2/4p3/4P3/2N5/PPPP1PPP/R1BQKBNR w KQkq - 2 3', 'Nd5'],
  ['ungedeckte Figur nicht genommen', 'rnbqk1nr/pppp1ppp/8/2b1p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3', 'a3'],
  ['Königsflügel schwächen', 'r1bq1rk1/ppp2ppp/2np1n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQ1RK1 w - - 0 7', 'g4'],
  ['Patt', '7k/8/6K1/8/8/8/8/5Q2 w - - 0 1', 'Qf7'],
  ['Gabel erlaubt', '4k3/pp6/8/8/3n4/7R/PP6/4K3 w - - 0 1', 'Ra3'],
  ['Bauer genommen, Figur weg', 'rnbqkbnr/ppp2ppp/8/3pp3/4P3/2N5/PPPP1PPP/R1BQKBNR w KQkq - 0 3', 'Nxd5'],
  ['Dame früh', 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2', 'Qf3'],
  ['Spieß', '8/8/8/3k4/8/8/3q4/R3K3 w - - 0 1', 'Kf1'],
];

const out = document.getElementById('out');
(async () => {
  const eng = new Engine();
  await eng.ready;
  for (const [name, fen, san] of CASES) {
    const c = new Chess(fen);
    const move = c.move(san);
    const before = await eng.analyse(fen, { depth: 15, movetime: 1500 });
    const after = c.isGameOver() ? { lines: [], bestmove: null } : await eng.analyse(move.after, { depth: 15, movetime: 1500 });
    const r = reviewMove({ fenBefore: fen, move, before, after });
    out.textContent += `\n### ${name}: ${san} -> ${r.cls} (${r.evalBefore} -> ${r.evalAfter}) best ${r.bestSan}\n${r.text.join('\n')}\n`;
  }
  out.textContent += '\nDONE';
})();
