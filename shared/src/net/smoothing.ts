import { MAX_EXTRAPOLATE } from './protocol.js';

/**
 * Estimates the server's clock from ping round trips. Times are in seconds.
 * Keeps recent samples and trusts the one with the shortest round trip,
 * since it carries the least queueing delay.
 */
export class ServerClock {
  private samples: Array<{ rtt: number; offset: number }> = [];
  private offset: number | null = null;
  /** Shortest recent round trip, seconds. */
  rtt = 0;

  constructor(private readonly keep = 12) {}

  get synced(): boolean { return this.offset !== null; }

  /** `sentAt` and `receivedAt` are local times; `serverTime` is the server's clock when it answered. */
  sample(sentAt: number, receivedAt: number, serverTime: number): void {
    const rtt = Math.max(0, receivedAt - sentAt);
    this.samples.push({ rtt, offset: serverTime + rtt / 2 - receivedAt });
    if (this.samples.length > this.keep) this.samples.shift();
    let best = this.samples[0]!;
    for (const s of this.samples) if (s.rtt < best.rtt) best = s;
    this.rtt = best.rtt;
    this.offset = best.offset;
  }

  /** Server time now, given the local time now. */
  now(local: number): number {
    return local + (this.offset ?? 0);
  }
}

export interface TrackSample {
  /** Server time the position was true. */
  at: number;
  x: number; y: number; z: number;
  vx: number; vz: number;
  facing: number;
}

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * How far in the past to draw: 'auto' draws just behind the newest sample, so the shape
 * is always one the other machine really made (interpolation); a number draws that many
 * seconds behind now and runs ahead along the velocity when samples are late (dead reckoning).
 */
export type TrackDelay = 'auto' | number;

/**
 * Where to draw something another machine moves. Keeps the last second of samples,
 * reads the pose at the drawing time between them (curving with their velocities),
 * and folds any jump in over `settle` seconds.
 */
export class RemoteTrack {
  private readonly samples: TrackSample[] = [];
  readonly shown = { x: 0, y: 0, z: 0, facing: 0 };
  /** Speed over the ground being shown, metres per second. */
  speed = 0;
  /** Smoothed age of the newest sample when it arrives, seconds. */
  private age = 0;
  private started = false;

  constructor(
    private readonly delay: TrackDelay = 'auto',
    private readonly settle = 0.08,
    private readonly maxAhead = MAX_EXTRAPOLATE,
    private readonly snapDistance = 4,
  ) {}

  get ready(): boolean { return this.samples.length > 0; }
  get sample(): TrackSample | null { return this.samples[this.samples.length - 1] ?? null; }

  /** Adds a sample; `now` is the server time it arrived, used to learn how late samples run. */
  push(s: TrackSample, now?: number): void {
    const last = this.sample;
    if (last && s.at <= last.at) return;
    this.samples.push(s);
    while (this.samples.length > 2 && this.samples[0]!.at < s.at - 1) this.samples.shift();
    if (now !== undefined) {
      const age = Math.max(0, now - s.at);
      this.age = this.samples.length === 1 ? age : this.age + (age - this.age) * 0.1;
    }
  }

  /** How far behind now the track draws, seconds. */
  behind(): number {
    // One snapshot gap of margin keeps a sample on each side of the drawing time.
    return this.delay === 'auto' ? this.age + 0.06 : this.delay;
  }

  /** The pose at server time t: between samples, or run ahead from the newest. */
  poseAt(t: number): { x: number; y: number; z: number; facing: number } {
    const list = this.samples;
    const last = list[list.length - 1]!;
    if (t >= last.at) {
      const ahead = Math.min(this.maxAhead, t - last.at);
      return { x: last.x + last.vx * ahead, y: last.y, z: last.z + last.vz * ahead, facing: last.facing };
    }
    let i = list.length - 1;
    while (i > 0 && list[i - 1]!.at > t) i--;
    const b = list[i]!;
    const a = list[i - 1];
    if (!a) return { x: b.x, y: b.y, z: b.z, facing: b.facing };
    const span = b.at - a.at;
    const u = span > 0 ? (t - a.at) / span : 1;
    // Cubic Hermite through both samples with their velocities: turns stay round.
    const h00 = 2 * u ** 3 - 3 * u ** 2 + 1, h10 = u ** 3 - 2 * u ** 2 + u, h01 = -2 * u ** 3 + 3 * u ** 2, h11 = u ** 3 - u ** 2;
    return {
      x: h00 * a.x + h10 * span * a.vx + h01 * b.x + h11 * span * b.vx,
      y: a.y + (b.y - a.y) * u,
      z: h00 * a.z + h10 * span * a.vz + h01 * b.z + h11 * span * b.vz,
      facing: a.facing + wrap(b.facing - a.facing) * u,
    };
  }

  /** Advances the shown pose to server time `now`, `dt` seconds after the last call. */
  update(now: number, dt: number): typeof this.shown {
    if (!this.ready) return this.shown;
    const target = this.poseAt(now - this.behind());
    const sh = this.shown;
    const px = sh.x;
    const pz = sh.z;
    if (!this.started || Math.hypot(target.x - sh.x, target.z - sh.z) > this.snapDistance) {
      sh.x = target.x; sh.y = target.y; sh.z = target.z; sh.facing = target.facing;
      this.started = true;
      this.lastTarget = target;
      return sh;
    }
    const k = dt > 0 ? 1 - Math.exp(-dt / this.settle) : 1;
    // The target already moves smoothly; the blend only hides a late sample's correction.
    const prevTarget = this.lastTarget ?? target;
    sh.x += target.x - prevTarget.x;
    sh.z += target.z - prevTarget.z;
    sh.x += (target.x - sh.x) * k;
    sh.z += (target.z - sh.z) * k;
    sh.y += (target.y - sh.y) * k;
    sh.facing = wrap(sh.facing + wrap(target.facing - sh.facing) * Math.min(1, k * 1.5));
    this.lastTarget = target;
    this.speed = dt > 0 ? Math.hypot(sh.x - px, sh.z - pz) / dt : this.speed;
    return sh;
  }

  private lastTarget: { x: number; z: number } | null = null;
}
