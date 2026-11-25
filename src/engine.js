// Kleiner UCI-Wrapper um Stockfish (WASM) in einem Web Worker.
// Befehle werden nacheinander abgearbeitet, damit sich Suchen nicht überschneiden.

const ENGINE_URL = 'engine/stockfish-18-lite-single.js';
const START_TIMEOUT = 20000; // WASM laden und kompilieren kann auf dem Handy dauern
const PING_TIMEOUT = 4000;
const SEARCH_SLACK = 6000; // Zusatzzeit über movetime hinaus, bevor die Engine als hängend gilt

// iOS beendet Web Worker gelegentlich still (z. B. wenn die App im Hintergrund war
// oder der Speicher knapp wird). Dann kommt nie wieder eine Antwort. Deshalb hat jede
// Anfrage ein Zeitlimit, und eine hängende Engine wird automatisch neu gestartet.
export class Engine {
  constructor() {
    this.listeners = new Set();
    this.waiters = new Set();
    this.options = new Map([['Hash', 16]]);
    this.queue = Promise.resolve();
    this.ready = this._start().catch(() => this._start());
  }

  _start() {
    if (this.worker) {
      this.worker.onmessage = null;
      this.worker.onerror = null;
      this.worker.terminate();
    }
    this._failAll(new Error('Engine neu gestartet'));
    const w = new Worker(ENGINE_URL);
    this.worker = w;
    w.onmessage = (e) => {
      if (w !== this.worker) return;
      const line = typeof e.data === 'string' ? e.data : String(e.data);
      for (const l of [...this.listeners]) l(line);
    };
    w.onerror = (e) => {
      if (w !== this.worker) return;
      this._failAll(new Error(e?.message || 'Engine abgestürzt'));
    };
    return this._init();
  }

  async _init() {
    await this._request('uci', (l) => l === 'uciok', START_TIMEOUT);
    for (const [name, value] of this.options) this.send(`setoption name ${name} value ${value}`);
    await this._request('isready', (l) => l === 'readyok', START_TIMEOUT);
  }

  restart() {
    this.ready = this._start();
    return this.ready;
  }

  _failAll(err) {
    for (const w of [...this.waiters]) w.reject(err);
  }

  send(cmd) {
    this.worker.postMessage(cmd);
  }

  waitFor(predicate, timeout = 0) {
    return new Promise((resolve, reject) => {
      let timer = null;
      const waiter = {
        reject: (err) => {
          cleanup();
          reject(err);
        },
      };
      const fn = (line) => {
        if (predicate(line)) {
          cleanup();
          resolve(line);
        }
      };
      const cleanup = () => {
        clearTimeout(timer);
        this.listeners.delete(fn);
        this.waiters.delete(waiter);
      };
      if (timeout) timer = setTimeout(() => waiter.reject(new Error('Engine antwortet nicht')), timeout);
      this.listeners.add(fn);
      this.waiters.add(waiter);
    });
  }

  _request(cmd, predicate, timeout) {
    const p = this.waitFor(predicate, timeout);
    this.send(cmd);
    return p;
  }

  isReady(timeout = PING_TIMEOUT) {
    return this._request('isready', (l) => l === 'readyok', timeout);
  }

  // Prüft, ob die Engine noch lebt (z. B. wenn die App wieder in den Vordergrund kommt).
  check() {
    return this._exclusive(() => this.isReady()).catch(() => {});
  }

  // Führt fn exklusiv aus (eine Suche zur Zeit pro Engine).
  // Hängt oder stirbt die Engine dabei, wird sie neu gestartet und fn ein zweites Mal versucht.
  _exclusive(fn) {
    const attempt = async () => {
      try {
        await this.ready;
      } catch {
        await this.restart();
      }
      return fn();
    };
    const run = this.queue.then(() =>
      attempt().catch(async () => {
        await this.restart();
        return fn();
      })
    );
    this.queue = run.catch(() => {});
    return run;
  }

  async setOption(name, value) {
    return this._exclusive(async () => {
      this.send(`setoption name ${name} value ${value}`);
      this.options.set(name, value);
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
      const done = this.waitFor((l) => l.startsWith('bestmove'), movetime + SEARCH_SLACK);
      this.send(`setoption name MultiPV value ${multipv}`);
      this.send(`position fen ${fen}`);
      this.send(`go depth ${depth} movetime ${movetime}`);
      let best;
      try {
        best = await done;
      } finally {
        this.listeners.delete(onInfo);
      }
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
  return line.cp ?? 0;
}

// Gewinnchance (0..1) für Weiß, wie bei Lichess.
export function winChance(cp) {
  const c = Math.max(-1000, Math.min(1000, cp));
  return 1 / (1 + Math.exp(-0.00368208 * c));
}
