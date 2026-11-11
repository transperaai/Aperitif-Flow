/**
 * Binary min-heap of timed events. Ties on time are broken by insertion
 * order, so the simulation is deterministic regardless of heap layout.
 *
 * Times, insertion numbers and events sit in three parallel arrays moved in
 * step, so pushing an event allocates nothing beyond the event itself (the
 * event loop pushes several per item and step; issue #19's servicing tasks
 * made that the hot path).
 */
export class EventQueue<T extends { t: number }> {
  private times: number[] = [];
  private seqs: number[] = [];
  private evs: T[] = [];
  private seq = 0;

  get size(): number {
    return this.evs.length;
  }

  /** The earliest pending event's time (Infinity when empty). */
  minTime(): number {
    return this.evs.length ? this.times[0]! : Infinity;
  }

  push(ev: T): void {
    const { times, seqs, evs } = this;
    const t = ev.t;
    const s = this.seq++;
    let i = evs.length;
    times.push(t);
    seqs.push(s);
    evs.push(ev);
    // Sift up: move parents down into the hole until the new event fits.
    while (i > 0) {
      const parent = (i - 1) >> 1;
      const pt = times[parent]!;
      if (!(t < pt || (t === pt && s < seqs[parent]!))) break;
      times[i] = pt;
      seqs[i] = seqs[parent]!;
      evs[i] = evs[parent]!;
      i = parent;
    }
    times[i] = t;
    seqs[i] = s;
    evs[i] = ev;
  }

  pop(): T | undefined {
    const { times, seqs, evs } = this;
    if (!evs.length) return undefined;
    const top = evs[0]!;
    const lastT = times.pop()!;
    const lastS = seqs.pop()!;
    const lastE = evs.pop()!;
    const n = evs.length;
    if (n) {
      // Sift down: move the smaller child up into the hole until the last event fits.
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        let c = l;
        let ct = times[l]!;
        let cs = seqs[l]!;
        const r = l + 1;
        if (r < n) {
          const rt = times[r]!;
          const rs = seqs[r]!;
          if (rt < ct || (rt === ct && rs < cs)) {
            c = r;
            ct = rt;
            cs = rs;
          }
        }
        if (!(ct < lastT || (ct === lastT && cs < lastS))) break;
        times[i] = ct;
        seqs[i] = cs;
        evs[i] = evs[c]!;
        i = c;
      }
      times[i] = lastT;
      seqs[i] = lastS;
      evs[i] = lastE;
    }
    return top;
  }
}
