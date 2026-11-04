/**
 * The zone room's wire messages. Arrays keep snapshots small; each tuple's
 * fields are named in the type beside it.
 */

/** Server snapshots per second. */
export const SNAPSHOT_HZ = 20;
/** Client movement reports per second. */
export const MOVE_HZ = 20;
/** Longest a client may extrapolate another player or enemy before holding still, in seconds. */
export const MAX_EXTRAPOLATE = 0.35;
/** How far back the server rewinds an enemy to judge a hit, in seconds. */
export const MAX_REWIND = 0.35;

/** Client to server: where I am. `t` is the client's estimate of server time when sampled. */
export interface MoveMsg {
  t: number;
  x: number; y: number; z: number;
  vx: number; vz: number;
  f: number;
  /** Animation clip playing, and its playback rate. */
  a: string;
  r: number;
}

/**
 * Client to server: "my swing `sw` with move `m` touched enemy `e`".
 * `t` is the server time the swing started, `v` the server time of the enemy pose the client saw.
 */
export interface HitMsg {
  e: string;
  m: string;
  sw: number;
  t: number;
  v: number;
  lit: boolean;
}

export interface PingMsg { c: number }
export interface PongMsg { c: number; t: number }

/** [id, x, y, z, vx, vz, facing, clip, rate, sampledAt, hp, maxHp] */
export type PlayerTuple = [string, number, number, number, number, number, number, string, number, number, number, number];
/** [id, kind, x, z, vx, vz, facing, state, hp, maxHp] */
export type EnemyTuple = [string, string, number, number, number, number, number, string, number, number];

export interface SnapMsg { t: number; p: PlayerTuple[]; e: EnemyTuple[] }

export interface WelcomeMsg {
  you: string;
  t: number;
  zone: string;
  element: string;
  role: string;
  /** The player's fighting tier, as the server holds it. */
  tier?: number;
}

export interface HitResultMsg { e: string; sw: number; ok: boolean; reason?: string; damage?: number }
export interface EnemyHitMsg { e: string; d: number; hp: number; by: string }
export interface EnemyDiedMsg { e: string; by: string; x: number; z: number }
export interface HurtMsg { by: string; d: number; hp: number; max: number }

export interface PlayerView {
  id: string;
  x: number; y: number; z: number;
  vx: number; vz: number;
  facing: number;
  clip: string;
  rate: number;
  sampledAt: number;
  hp: number;
  maxHp: number;
}

export interface EnemyView {
  id: string;
  kind: string;
  x: number; z: number;
  vx: number; vz: number;
  facing: number;
  state: string;
  hp: number;
  maxHp: number;
}

export const playerFromTuple = (p: PlayerTuple): PlayerView => ({
  id: p[0], x: p[1], y: p[2], z: p[3], vx: p[4], vz: p[5], facing: p[6], clip: p[7], rate: p[8], sampledAt: p[9], hp: p[10], maxHp: p[11],
});

export const enemyFromTuple = (e: EnemyTuple): EnemyView => ({
  id: e[0], kind: e[1], x: e[2], z: e[3], vx: e[4], vz: e[5], facing: e[6], state: e[7], hp: e[8], maxHp: e[9],
});

/** Rounds to centimetres so snapshots stay short. */
export const cm = (n: number): number => Math.round(n * 100) / 100;
