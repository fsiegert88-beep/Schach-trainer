// Kleiner UCI-Wrapper um Stockfish (WASM) in einem Web Worker.
// Befehle werden nacheinander abgearbeitet, damit sich Suchen nicht überschneiden.

const ENGINE_URL = 'engine/stockfish-18-lite-single.js';

export class Engine {
  constructor() {
    this.worker = new Worker(ENGINE_URL);
    this.listeners = new Set();
    this.queue = Promise.resolve();
    this.worker.onmessage = (e) => {
      const line = typeof e.data === 'string' ? e.data : String(e.data);
      for (const l of [...this.listeners]) l(line);
    };
    this.ready = this._init();
  }

  send(cmd) {
    this.worker.postMessage(cmd);
  }

  waitFor(predicate) {
    return new Promise((resolve) => {
      const fn = (line) => {
        if (predicate(line)) {
          this.listeners.delete(fn);
          resolve(line);
        }
      };
      this.listeners.add(fn);
    });
  }

  async _init() {
    const ok = this.waitFor((l) => l === 'uciok');
    this.send('uci');
    await ok;
    this.send('setoption name Hash value 16');
    await this.isReady();
  }

  async isReady() {
    const ok = this.waitFor((l) => l === 'readyok');
    this.send('isready');
    await ok;
  }

  // Führt fn exklusiv aus (eine Suche zur Zeit pro Engine).
  _exclusive(fn) {
    const run = this.queue.then(() => this.ready).then(fn);
    this.queue = run.catch(() => {});
    return run;
  }

  async setOption(name, value) {
    return this._exclusive(async () => {
      this.send(`setoption name ${name} value ${value}`);
      await this.isReady();
    });
  }

  newGame() {
    return this._exclusive(async () => {
      this.send('ucinewgame');
      await this.isReady();
    });
  }

  // Analysiert eine Stellung. Ergebnis-Bewertungen sind aus Sicht von Weiß.
  // Rückgabe: { bestmove, lines: [{ cp, mate, pv: [uci...], depth }] }
  analyse(fen, { depth = 14, movetime = 1500, multipv = 1 } = {}) {
    return this._exclusive(async () => {
      const whiteToMove = fen.split(' ')[1] === 'w';
      const lines = [];
      const onInfo = (line) => {
        if (!line.startsWith('info') || !line.includes(' pv ')) return;
        const m = line.match(/ depth (\d+).*? multipv (\d+).*? score (cp|mate) (-?\d+).*? pv (.+)$/);
        if (!m) return;
        const idx = Number(m[2]) - 1;
        let val = Number(m[4]);
        if (!whiteToMove) val = -val;
        lines[idx] = {
          depth: Number(m[1]),
          cp: m[3] === 'cp' ? val : null,
          mate: m[3] === 'mate' ? val : null,
          pv: m[5].trim().split(/\s+/),
        };
      };
      this.listeners.add(onInfo);
      this.send(`setoption name MultiPV value ${multipv}`);
      this.send(`position fen ${fen}`);
      const done = this.waitFor((l) => l.startsWith('bestmove'));
      this.send(`go depth ${depth} movetime ${movetime}`);
      const best = await done;
      this.listeners.delete(onInfo);
      const bestmove = best.split(/\s+/)[1];
      return {
        bestmove: bestmove && bestmove !== '(none)' ? bestmove : null,
        lines: lines.filter(Boolean),
      };
    });
  }
}

// Bewertung (Weiß-Sicht) als Zentibauern; Matt wird auf große Werte abgebildet.
export function scoreToCp(line) {
  if (!line) return 0;
  if (line.mate !== null && line.mate !== undefined) {
    if (line.mate === 0) return 0;
    return Math.sign(line.mate) * (10000 - Math.abs(line.mate) * 10);
  }
  return line.cp;
}

// Gewinnchance (0..1) für Weiß, wie bei Lichess.
export function winChance(cp) {
  const c = Math.max(-1000, Math.min(1000, cp));
  return 1 / (1 + Math.exp(-0.00368208 * c));
}
