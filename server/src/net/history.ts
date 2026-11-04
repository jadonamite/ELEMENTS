/** A short record of where something was, so a hit can be judged against the pose the attacker saw. */
export class PoseHistory {
  private readonly items: Array<{ t: number; x: number; z: number; f: number }> = [];

  constructor(private readonly span = 1) {}

  push(t: number, x: number, z: number, f: number): void {
    const last = this.items[this.items.length - 1];
    if (last && t < last.t) return;
    if (last && t === last.t) { last.x = x; last.z = z; last.f = f; return; }
    this.items.push({ t, x, z, f });
    while (this.items.length > 2 && this.items[0]!.t < t - this.span) this.items.shift();
  }

  clear(): void { this.items.length = 0; }

  /** Pose at time t, blended between the two records around it; the nearest end outside the record. */
  at(t: number): { x: number; z: number; f: number } | null {
    const items = this.items;
    if (items.length === 0) return null;
    if (t <= items[0]!.t) return { ...items[0]! };
    const last = items[items.length - 1]!;
    if (t >= last.t) return { ...last };
    for (let i = items.length - 1; i > 0; i--) {
      const a = items[i - 1]!;
      const b = items[i]!;
      if (t >= a.t) {
        const k = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0;
        return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k, f: k < 0.5 ? a.f : b.f };
      }
    }
    return { ...items[0]! };
  }
}
