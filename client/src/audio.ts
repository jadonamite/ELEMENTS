import { lineKey } from '../../shared/src/story/voice.js';

/**
 * Sample-based sound manager using Web Audio API.
 * Uses recorded CC0 game audio clips, randomized pitch and volume variations,
 * separate SFX, footsteps, ambient and music busses, positional audio for villains,
 * master dynamics compression to avoid clipping, and automatic tab muting.
 */

export interface SoundPosition {
  x: number;
  y: number;
  z: number;
}

export interface SoundCameraLike {
  position: SoundPosition;
  quaternion: { x: number; y: number; z: number; w: number };
}

export interface SoundControllerLike {
  position: SoundPosition;
  speed: number;
  /** False in a jump or a fall; taken as true when absent. */
  grounded?: boolean;
}

/** How a kind of ground sounds underfoot. */
export type StepFamily = 'stone' | 'slab' | 'dirt' | 'gravel' | 'grass' | 'wood' | 'tile' | 'cloth';

/** The sound family of a built surface, by the name the world gives it. */
export function stepFamily(surface: string | null | undefined): StepFamily {
  switch (surface) {
    case 'worn_flagstones': case 'ashlar_stone_blocks': case 'pale_stone': case 'lime_plaster':
    case 'sooted_plaster': case 'ash_plaster': case 'red_lacquer': case 'gold_trim':
      return 'slab';
    case 'packed_dirt_road': case 'dirt_verge':
      return 'dirt';
    case 'ash_cinder_ground':
      return 'gravel';
    case 'moss':
      return 'grass';
    case 'charred_timber_beams': case 'raw_timber':
      return 'wood';
    case 'roof_slates': case 'roof_tile_charcoal': case 'roof_tile_red': case 'terracotta':
      return 'tile';
    case 'indigo_cloth':
      return 'cloth';
    default:
      return 'stone';
  }
}

export interface SoundEnemyLike {
  readonly controller: SoundControllerLike;
  /** Feet that landed this frame (bit 1 left, bit 2 right); absent for bodies whose feet are not tracked. */
  readonly steps?: number | undefined;
  readonly alive: boolean;
  readonly state?: string;
  readonly attacking?: boolean;
}

export interface SoundSwordLike {
  readonly armed: boolean;
  readonly engaged: boolean;
  readonly phase?: string;
}

export interface SoundWorldContext {
  minute?: number;
  playerPos?: SoundPosition;
  /** Feet of the hero that landed this frame (bit 1 left, bit 2 right); absent when feet are not tracked. */
  heroSteps?: number | undefined;
  /** Where the town was built to be busy: stalls and counters, and anvils. */
  market?: readonly SoundPosition[];
  forge?: readonly SoundPosition[];
  /** The people of the town, wherever they are now. */
  people?: readonly { readonly position: SoundPosition }[] | undefined;
  /** The built surface under a pair of feet, as the world names it. */
  surfaceAt?: (position: SoundPosition) => string | null;
}

export interface SoundManagerOptions {
  sfxVolume?: number;
  musicVolume?: number;
  fxQuality?: 'high' | 'low';
}

/** The ambient bus, 12 dB under hits. */
const AMBIENT_LEVEL = 0.25;

/** How strongly a listener hears one source: full inside `near` metres, nothing beyond `far`. */
function falloff(p: SoundPosition, at: SoundPosition, near: number, far: number): number {
  const d = Math.hypot(p.x - at.x, p.y - at.y, p.z - at.z);
  return d <= near ? 1 : d >= far ? 0 : 1 - (d - near) / (far - near);
}

/** How present a kind of place is, 0..1: the sources in earshot, where `full` of them close by is as loud as it gets. */
export function nearness(p: SoundPosition, sources: readonly SoundPosition[] | undefined, near: number, far: number, full: number): number {
  if (!sources) return 0;
  let sum = 0;
  for (const at of sources) sum += falloff(p, at, near, far);
  return Math.min(1, sum / full);
}

function nearnessOfPeople(p: SoundPosition, people: readonly { readonly position: SoundPosition }[] | undefined,
  near: number, far: number, full: number): number {
  if (!people) return 0;
  let sum = 0;
  for (const person of people) sum += falloff(p, person.position, near, far);
  return Math.min(1, sum / full);
}

/** Speed, in m/s, from which a step is a running step. */
const RUN_SPEED = 3.8;

interface Stride {
  strideDistance: number;
  lastStepRight: boolean;
}

interface VillainAudioState extends Stride {
  strideDistance: number;
  wasAttacking: boolean;
  deathPlayed: boolean;
  lastStepRight: boolean;
}

/** Loudness of spoken lines, and how far music and ambience drop under them. */
const VOICE_VOLUME = 1.0;
const VOICE_DUCK = 0.35;

export class SoundManager {
  private ctx: AudioContext | null = null;
  private sfxGain: GainNode | null = null;
  private footstepGain: GainNode | null = null;
  private ambientGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private masterGain: GainNode | null = null;
  /** Lines playing now, one per channel (a speaker); a new line on a channel replaces its old one. */
  private readonly voices = new Map<string, AudioBufferSourceNode>();
  private voiceManifest: Promise<Record<string, Record<string, number>> | null> | null = null;
  private voiceOpus: boolean | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private analyser: AnalyserNode | null = null;

  private quality: 'high' | 'low' = 'high';
  private muted = false;
  private unlocked = false;

  private readonly buffers = new Map<string, AudioBuffer[]>();

  // Ambient layer loops and drift state
  ambientSources: AudioBufferSourceNode[] = [];
  ambientLayerGains: GainNode[] = [];
  private ambientClock = 0;
  ambientActive = false;

  // Hero locomotion and stride
  private readonly heroStride: Stride = { strideDistance: 0, lastStepRight: false };

  // Sword state tracking for draw/sheathe foley
  private lastSwordArmed = false;
  private lastSwordEngaged = false;

  // Villain audio tracking
  private readonly villainStates = new Map<SoundEnemyLike, VillainAudioState>();

  // Peak analysis buffer for clipping checks
  private readonly events = new AbortController();
  private peakBuffer: Float32Array<ArrayBuffer> | null = null;

  constructor(options: SoundManagerOptions = {}) {
    if (typeof window === 'undefined') return;
    (window as unknown as { sound?: SoundManager }).sound = this;
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    try {
      const urlFxQuality = new URLSearchParams(window.location.search).get('fxQuality');
      this.quality = options.fxQuality ?? (urlFxQuality === 'low' ? 'low' : 'high');

      this.ctx = new AudioCtx();

      // Master output chain: masterGain -> compressor -> analyser -> destination
      this.masterGain = this.ctx.createGain();
      this.compressor = this.ctx.createDynamicsCompressor();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 256;
      this.peakBuffer = new Float32Array(this.analyser.fftSize);

      // Limiter / mastering compressor settings to ensure six villains never clip
      this.compressor.threshold.setValueAtTime(-6, this.ctx.currentTime);
      this.compressor.knee.setValueAtTime(4, this.ctx.currentTime);
      this.compressor.ratio.setValueAtTime(20, this.ctx.currentTime);
      this.compressor.attack.setValueAtTime(0.001, this.ctx.currentTime);
      this.compressor.release.setValueAtTime(0.12, this.ctx.currentTime);

      const masterCeiling = this.ctx.createGain();
      masterCeiling.gain.setValueAtTime(0.85, this.ctx.currentTime);

      this.masterGain.connect(this.compressor);
      this.compressor.connect(masterCeiling);
      masterCeiling.connect(this.analyser);
      this.analyser.connect(this.ctx.destination);

      // Separate mix busses
      this.sfxGain = this.ctx.createGain();
      this.footstepGain = this.ctx.createGain();
      this.ambientGain = this.ctx.createGain();
      this.musicGain = this.ctx.createGain();

      // Mix balance:
      // Hits are the loudest thing (0 dB reference ~ 1.0)
      // Footsteps sit ~12 dB under hits (-12 dB = 0.251)
      // Ambient sits ~12 dB under hits (AMBIENT_LEVEL), so a street is heard between blows
      this.sfxGain.gain.setValueAtTime(options.sfxVolume ?? 1.0, this.ctx.currentTime);
      this.footstepGain.gain.setValueAtTime(0.251, this.ctx.currentTime);
      this.ambientGain.gain.setValueAtTime(0.0001, this.ctx.currentTime); // Fades in on unlock
      this.musicGain.gain.setValueAtTime(options.musicVolume ?? 0.5, this.ctx.currentTime);

      this.sfxGain.connect(this.masterGain);
      this.footstepGain.connect(this.masterGain);
      this.ambientGain.connect(this.masterGain);
      this.musicGain.connect(this.masterGain);

      const unlock = (): void => {
        if (!this.ctx || this.unlocked || document.getElementById('elements-loader') || document.getElementById('opening-overlay')) return;
        const start = (): void => {
          this.unlocked = true;
          window.removeEventListener('pointerdown', unlock);
          window.removeEventListener('keydown', unlock);
          this.startAmbientBed();
        };

        if (this.ctx.state === 'suspended') {
          this.ctx.resume().then(start).catch(() => {});
        } else {
          start();
        }
      };

      window.addEventListener('pointerdown', unlock, { signal: this.events.signal });
      window.addEventListener('keydown', unlock, { signal: this.events.signal });

      document.addEventListener('visibilitychange', () => {
        this.setMuted(document.hidden);
      }, { signal: this.events.signal });

      this.loadAllSamples();
    } catch {
      // AudioContext disallowed or disabled
    }
  }

  private loadAllSamples(): void {
    const definitions: Record<string, string[]> = {
      light_swing: [
        '/assets/audio/swing_light_01.ogg',
        '/assets/audio/swing_light_02.ogg',
        '/assets/audio/swing_light_03.ogg',
        '/assets/audio/swing_light_04.ogg',
      ],
      heavy_swing: [
        '/assets/audio/swing_heavy_01.ogg',
        '/assets/audio/swing_heavy_02.ogg',
        '/assets/audio/swing_heavy_03.ogg',
        '/assets/audio/swing_heavy_04.ogg',
      ],
      hit_flesh: [
        '/assets/audio/hit_flesh_01.ogg',
        '/assets/audio/hit_flesh_02.ogg',
        '/assets/audio/hit_flesh_03.ogg',
      ],
      hit_blocked: [
        '/assets/audio/hit_blocked_01.ogg',
        '/assets/audio/hit_blocked_02.ogg',
        '/assets/audio/hit_blocked_03.ogg',
        '/assets/audio/hit_blocked_04.ogg',
      ],
      kill_blow: [
        '/assets/audio/kill_blow_01.ogg',
        '/assets/audio/kill_blow_02.ogg',
        '/assets/audio/kill_blow_03.ogg',
      ],
      hero_hurt: [
        '/assets/audio/hero_hurt_01.ogg',
        '/assets/audio/hero_hurt_02.ogg',
        '/assets/audio/hero_hurt_03.ogg',
        '/assets/audio/hero_hurt_04.ogg',
      ],
      villain_hurt: [
        '/assets/audio/villain_hurt_01.ogg',
        '/assets/audio/villain_hurt_02.ogg',
        '/assets/audio/villain_hurt_03.ogg',
        '/assets/audio/villain_hurt_04.ogg',
      ],
      villain_death: [
        '/assets/audio/villain_death_01.ogg',
        '/assets/audio/villain_death_02.ogg',
        '/assets/audio/villain_death_03.ogg',
        '/assets/audio/villain_death_04.ogg',
      ],
      dodge: [
        '/assets/audio/dodge_01.ogg',
        '/assets/audio/dodge_02.ogg',
        '/assets/audio/dodge_03.ogg',
        '/assets/audio/dodge_04.ogg',
      ],
      ground_pound: [
        '/assets/audio/ground_pound_01.ogg',
        '/assets/audio/ground_pound_02.ogg',
        '/assets/audio/ground_pound_03.ogg',
        '/assets/audio/ground_pound_04.ogg',
      ],
      fire_burst: [
        '/assets/audio/fire_burst_01.ogg',
        '/assets/audio/fire_burst_02.ogg',
        '/assets/audio/fire_burst_03.ogg',
        '/assets/audio/fire_burst_04.ogg',
      ],
      draw: [
        '/assets/audio/sword_draw_01.ogg',
        '/assets/audio/sword_draw_02.ogg',
        '/assets/audio/sword_draw_03.ogg',
      ],
      sheathe: [
        '/assets/audio/sword_sheathe_01.ogg',
        '/assets/audio/sword_sheathe_02.ogg',
        '/assets/audio/sword_sheathe_03.ogg',
      ],
      thump: [
        '/assets/audio/thump_01.ogg',
        '/assets/audio/thump_02.ogg',
        '/assets/audio/thump_03.ogg',
      ],
      footstep_stone_walk: [
        '/assets/audio/footstep_stone_walk_01.ogg',
        '/assets/audio/footstep_stone_walk_02.ogg',
        '/assets/audio/footstep_stone_walk_03.ogg',
        '/assets/audio/footstep_stone_walk_04.ogg',
        '/assets/audio/footstep_stone_walk_05.ogg',
        '/assets/audio/footstep_stone_walk_06.ogg',
      ],
      footstep_stone_run: [
        '/assets/audio/footstep_stone_run_01.ogg',
        '/assets/audio/footstep_stone_run_02.ogg',
        '/assets/audio/footstep_stone_run_03.ogg',
        '/assets/audio/footstep_stone_run_04.ogg',
        '/assets/audio/footstep_stone_run_05.ogg',
        '/assets/audio/footstep_stone_run_06.ogg',
      ],
      ambient_wind: ['/assets/audio/ambient_wind.ogg'],
      ambient_birds: ['/assets/audio/ambient_birds.ogg'],
      ambient_forge_bell: ['/assets/audio/ambient_forge_bell.ogg'],
      ambient_forge_hammer: ['/assets/audio/ambient_forge_hammer.ogg'],
      ambient_market: ['/assets/audio/ambient_market.ogg'],
      ambient_night_insects: ['/assets/audio/ambient_night_insects.ogg'],
      footstep_slab: [
        '/assets/audio/footstep_slab_01.mp3',
        '/assets/audio/footstep_slab_02.mp3',
        '/assets/audio/footstep_slab_03.mp3',
        '/assets/audio/footstep_slab_04.mp3',
        '/assets/audio/footstep_slab_05.mp3',
      ],
      footstep_gravel: [
        '/assets/audio/footstep_gravel_01.mp3',
        '/assets/audio/footstep_gravel_02.mp3',
        '/assets/audio/footstep_gravel_03.mp3',
        '/assets/audio/footstep_gravel_04.mp3',
        '/assets/audio/footstep_gravel_05.mp3',
      ],
      footstep_grass: [
        '/assets/audio/footstep_grass_01.mp3',
        '/assets/audio/footstep_grass_02.mp3',
        '/assets/audio/footstep_grass_03.mp3',
        '/assets/audio/footstep_grass_04.mp3',
        '/assets/audio/footstep_grass_05.mp3',
      ],
      footstep_tile: [
        '/assets/audio/footstep_tile_01.mp3',
        '/assets/audio/footstep_tile_02.mp3',
        '/assets/audio/footstep_tile_03.mp3',
        '/assets/audio/footstep_tile_04.mp3',
        '/assets/audio/footstep_tile_05.mp3',
      ],
      footstep_cloth: [
        '/assets/audio/footstep_cloth_01.mp3',
        '/assets/audio/footstep_cloth_02.mp3',
        '/assets/audio/footstep_cloth_03.mp3',
        '/assets/audio/footstep_cloth_04.mp3',
        '/assets/audio/footstep_cloth_05.mp3',
      ],
      footstep_dirt_walk: [
        '/assets/audio/footstep_dirt_walk_01.ogg',
        '/assets/audio/footstep_dirt_walk_02.ogg',
        '/assets/audio/footstep_dirt_walk_03.ogg',
        '/assets/audio/footstep_dirt_walk_04.ogg',
      ],
      footstep_dirt_run: [
        '/assets/audio/footstep_dirt_run_01.ogg',
        '/assets/audio/footstep_dirt_run_02.ogg',
        '/assets/audio/footstep_dirt_run_03.ogg',
        '/assets/audio/footstep_dirt_run_04.ogg',
      ],
      footstep_wood_walk: [
        '/assets/audio/footstep_wood_walk_01.ogg',
        '/assets/audio/footstep_wood_walk_02.ogg',
        '/assets/audio/footstep_wood_walk_03.ogg',
        '/assets/audio/footstep_wood_walk_04.ogg',
      ],
      footstep_wood_run: [
        '/assets/audio/footstep_wood_run_01.ogg',
        '/assets/audio/footstep_wood_run_02.ogg',
        '/assets/audio/footstep_wood_run_03.ogg',
        '/assets/audio/footstep_wood_run_04.ogg',
      ],
      bark_guard: ['/assets/audio/bark_guard_01.ogg'],
      bark_smith: ['/assets/audio/bark_smith_01.ogg'],
      bark_innkeeper: ['/assets/audio/bark_innkeeper_01.ogg'],
      bark_male: [
        '/assets/audio/bark_male_01.ogg',
        '/assets/audio/bark_male_02.ogg',
      ],
      bark_female: [
        '/assets/audio/bark_female_01.ogg',
        '/assets/audio/bark_female_02.ogg',
      ],
    };

    for (const [key, urls] of Object.entries(definitions)) {
      this.buffers.set(key, []);
      for (const url of urls) {
        this.fetchAndDecode(url, key);
      }
    }
  }

  private async fetchAndDecode(url: string, category: string): Promise<void> {
    if (!this.ctx) return;
    try {
      const response = await fetch(url);
      if (!response.ok) return;
      const arrayBuffer = await response.arrayBuffer();
      if (!this.ctx) return;
      const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);
      const list = this.buffers.get(category);
      if (list) list.push(audioBuffer);

      // If ambient buffers load after unlock, start ambient bed
      if (this.unlocked && !this.ambientActive && category.startsWith('ambient_')) {
        this.startAmbientBed();
      }
    } catch {
      // Gracefully ignore missing or corrupted sound files
    }
  }

  /** Starts the 6-layered ambient bed with 2s fade-in once unlocked. */
  private startAmbientBed(): void {
    if (!this.ctx || !this.ambientGain || this.ambientActive) return;

    const layers = [
      'ambient_wind',
      'ambient_birds',
      'ambient_forge_bell',
      'ambient_forge_hammer',
      'ambient_market',
      'ambient_night_insects',
    ];
    const buffers: AudioBuffer[] = [];
    for (const key of layers) {
      const list = this.buffers.get(key);
      if (list && list.length > 0 && list[0]) {
        buffers.push(list[0]);
      }
    }

    if (buffers.length < layers.length) return; // Wait until all 6 are decoded

    this.ambientActive = true;
    this.ambientSources = [];
    this.ambientLayerGains = [];

    const now = this.ctx.currentTime;
    // Fade in ambient bed over 2.0 s
    this.ambientGain.gain.cancelScheduledValues(now);
    this.ambientGain.gain.setValueAtTime(0.0001, now);
    this.ambientGain.gain.exponentialRampToValueAtTime(AMBIENT_LEVEL, now + 2.0);

    const baseLevels = [0.75, 0.60, 0.45, 0.70, 0.75, 0.60];

    for (let i = 0; i < buffers.length; i++) {
      const buf = buffers[i];
      if (!buf) continue;
      const source = this.ctx.createBufferSource();
      source.buffer = buf;
      source.loop = true;

      const layerGain = this.ctx.createGain();
      layerGain.gain.setValueAtTime(baseLevels[i] ?? 0.7, now);

      source.connect(layerGain);
      layerGain.connect(this.ambientGain);

      source.start(0);
      this.ambientSources.push(source);
      this.ambientLayerGains.push(layerGain);
    }
  }

  /** Update listener transform from the camera. */
  private updateListener(camera: SoundCameraLike): void {
    if (!this.ctx) return;
    const listener = this.ctx.listener;
    const pos = camera.position;

    if (listener.positionX) {
      listener.positionX.setValueAtTime(pos.x, this.ctx.currentTime);
      listener.positionY.setValueAtTime(pos.y, this.ctx.currentTime);
      listener.positionZ.setValueAtTime(pos.z, this.ctx.currentTime);
    } else {
      (listener as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(pos.x, pos.y, pos.z);
    }

    // Forward (-Z) and Up (+Y) transformed by camera quaternion
    const q = camera.quaternion;
    const fx = -(2 * (q.x * q.z + q.w * q.y));
    const fy = -(2 * (q.y * q.z - q.w * q.x));
    const fz = -(1 - 2 * (q.x * q.x + q.y * q.y));

    const ux = 2 * (q.x * q.y - q.w * q.z);
    const uy = 1 - 2 * (q.x * q.x + q.z * q.z);
    const uz = 2 * (q.y * q.z + q.w * q.x);

    if (listener.forwardX) {
      listener.forwardX.setValueAtTime(fx, this.ctx.currentTime);
      listener.forwardY.setValueAtTime(fy, this.ctx.currentTime);
      listener.forwardZ.setValueAtTime(fz, this.ctx.currentTime);
      listener.upX.setValueAtTime(ux, this.ctx.currentTime);
      listener.upY.setValueAtTime(uy, this.ctx.currentTime);
      listener.upZ.setValueAtTime(uz, this.ctx.currentTime);
    } else {
      (listener as unknown as { setOrientation(x: number, y: number, z: number, ux: number, uy: number, uz: number): void })
        .setOrientation(fx, fy, fz, ux, uy, uz);
    }
  }

  /**
   * Main per-frame sound updater. Handles:
   * - Listener positioning
   * - Ambient loop volume drift across places (forge, market, terraces) and time (day, dusk, night)
   * - Hero and villain footsteps as each foot lands, on the ground the world reports under it
   * - Villain spatialized swings
   * - Sword draw/sheathe state foley
   */
  update(
    delta: number,
    camera?: SoundCameraLike,
    controller?: SoundControllerLike,
    enemies?: readonly SoundEnemyLike[],
    sword?: SoundSwordLike,
    worldContext?: SoundWorldContext,
  ): void {
    if (this.muted) return;

    if (camera && this.ctx) {
      this.updateListener(camera);
    }

    // Ambient spatial and time-of-day tuning across the 6 layers
    if (this.ambientActive && this.ambientLayerGains.length >= 6 && this.ctx) {
      this.ambientClock += delta;
      const t = this.ambientClock;
      const p = worldContext?.playerPos ?? controller?.position ?? camera?.position;
      const minute = worldContext?.minute ?? 4;
      const m = ((minute % 24) + 24) % 24;

      // Dusk factor: 0 by day, 1 at night, smooth ramp from 12..14
      const isNight = m >= 14 && m < 22;
      const isDusk = m >= 12 && m < 14;
      const duskProgress = isNight ? 1.0 : isDusk ? (m - 12) / 2 : (m >= 22 ? 1 - (m - 22) / 2 : 0);

      // Layer 0: ambient_wind (boosted on crag / terraces: x > 175, z < -25 or p.y > 1.8)
      const onTerraces = p && ((p.x > 175 && p.z < -25) || p.y > 1.8);
      const windTarget = (onTerraces ? 1.15 : 0.70) + 0.15 * Math.sin(t * 0.12);
      this.ambientLayerGains[0]?.gain.setTargetAtTime(Math.max(0.1, windTarget), this.ctx.currentTime, 0.1);

      // Layer 1: ambient_birds (day only, fades out at dusk/night)
      const birdsTarget = Math.max(0.01, (1.0 - duskProgress) * (0.55 + 0.2 * Math.sin(t * 0.08 + 1.2)));
      this.ambientLayerGains[1]?.gain.setTargetAtTime(birdsTarget, this.ctx.currentTime, 0.1);

      // Layer 2: ambient_forge_bell (distance to town, quietens at night)
      const bellTarget = (1.0 - 0.5 * duskProgress) * (0.45 + 0.15 * Math.sin(t * 0.057 + 2.7));
      this.ambientLayerGains[2]?.gain.setTargetAtTime(Math.max(0.05, bellTarget), this.ctx.currentTime, 0.1);

      // Layer 3: ambient_forge_hammer, heard from the nearest anvil the town was built with, quieter at dusk and night
      const forgeProx = p ? nearness(p, worldContext?.forge, 12, 60, 1) : 0;
      const forgeTime = isNight ? 0.2 : isDusk ? 0.5 : 1.0;
      const forgeHammerTarget = forgeProx * forgeTime * (0.8 + 0.2 * Math.sin(t * 0.3));
      this.ambientLayerGains[3]?.gain.setTargetAtTime(Math.max(0.001, forgeHammerTarget), this.ctx.currentTime, 0.1);

      // Layer 4: ambient_market, the murmur of trade: it rises with the stalls and the people near the listener,
      // so a market street is loud and an empty lane is not. Fades at dusk and night as the stalls shut.
      const stalls = p ? nearness(p, worldContext?.market, 4, 30, 16) : 0;
      const crowd = p ? nearnessOfPeople(p, worldContext?.people, 4, 22, 24) : 0;
      const marketTime = Math.max(0.02, 1.0 - duskProgress);
      const marketTarget = Math.max(stalls * marketTime, crowd * Math.max(0.35, marketTime)) * (0.85 + 0.15 * Math.sin(t * 0.2));
      this.ambientLayerGains[4]?.gain.setTargetAtTime(Math.max(0.001, marketTarget), this.ctx.currentTime, 0.1);

      // Layer 5: ambient_night_insects (fades in at dusk, active at night)
      const insectsTarget = duskProgress * (0.75 + 0.15 * Math.sin(t * 0.15));
      this.ambientLayerGains[5]?.gain.setTargetAtTime(Math.max(0.0001, insectsTarget), this.ctx.currentTime, 0.1);
    }

    // A step sounds when a foot lands, on whatever the world says is under it.
    const family = (position: SoundPosition): StepFamily => stepFamily(worldContext?.surfaceAt?.(position));
    if (controller) {
      const landed = this.footfalls(this.heroStride, controller, delta, worldContext?.heroSteps);
      for (const right of landed) {
        this.playFootstep(controller.speed >= RUN_SPEED, right ? 1.04 : 0.96, family(controller.position));
      }
    }

    // Villain spatialized footsteps and attack swings
    if (enemies) {
      for (const enemy of enemies) {
        if (!enemy.alive) {
          this.villainStates.delete(enemy);
          continue;
        }

        let state = this.villainStates.get(enemy);
        if (!state) {
          state = { strideDistance: Math.random() * 0.2, wasAttacking: false, deathPlayed: false, lastStepRight: false };
          this.villainStates.set(enemy, state);
        }

        const isAttacking = Boolean(enemy.attacking || enemy.state === 'attack' || enemy.state === 'cast');
        if (isAttacking && !state.wasAttacking) {
          this.playVillainSwing(enemy.controller.position);
        }
        state.wasAttacking = isAttacking;

        const steps = enemy.steps;
        const landed = this.footfalls(state, enemy.controller, delta, isAttacking && steps !== undefined ? 0 : steps);
        for (const right of landed) {
          this.playVillainFootstep(enemy.controller.position, enemy.controller.speed >= RUN_SPEED, right ? 1.03 : 0.95,
            family(enemy.controller.position));
        }
      }
    }

    // Sword foley tracking (draw / sheathe)
    if (sword) {
      if (sword.armed && !this.lastSwordArmed) {
        this.playDraw();
      } else if (!sword.armed && this.lastSwordArmed) {
        this.playSheathe();
      }
      this.lastSwordArmed = sword.armed;
      this.lastSwordEngaged = sword.engaged;
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (!this.masterGain || !this.ctx) return;
    this.masterGain.gain.setTargetAtTime(muted ? 0 : 1, this.ctx.currentTime, 0.03);
  }

  setSfxVolume(volume: number): void {
    if (!this.sfxGain || !this.ctx) return;
    this.sfxGain.gain.setTargetAtTime(Math.max(0, Math.min(1, volume)), this.ctx.currentTime, 0.05);
  }

  /** Create a PannerNode configured for villain spatialization. */
  createPanner(pos: SoundPosition): PannerNode | null {
    if (!this.ctx) return null;
    try {
      const panner = this.ctx.createPanner();
      panner.panningModel = this.quality === 'low' ? 'equalpower' : 'HRTF';
      panner.distanceModel = 'inverse';
      panner.refDistance = 2.0;
      panner.maxDistance = 45.0;
      panner.rolloffFactor = 1.0;

      if (panner.positionX) {
        panner.positionX.setValueAtTime(pos.x, this.ctx.currentTime);
        panner.positionY.setValueAtTime(pos.y, this.ctx.currentTime);
        panner.positionZ.setValueAtTime(pos.z, this.ctx.currentTime);
      } else {
        (panner as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(pos.x, pos.y, pos.z);
      }
      return panner;
    } catch {
      return null;
    }
  }

  private playSample(
    category: string,
    baseVolume = 1.0,
    pitchMult = 1.0,
    destGain: GainNode | null = this.sfxGain,
    position?: SoundPosition,
  ): void {
    if (!this.ctx || !destGain || this.muted) return;
    const list = this.buffers.get(category);
    if (!list || list.length === 0) return;
    const buffer = list[Math.floor(Math.random() * list.length)];
    if (!buffer) return;

    try {
      const source = this.ctx.createBufferSource();
      source.buffer = buffer;

      // Pitch variation (+/- 4%) and volume variation (+/- 10%)
      const pitchJitter = 1.0 + (Math.random() * 0.08 - 0.04);
      const volumeJitter = 1.0 + (Math.random() * 0.20 - 0.10);

      source.playbackRate.value = Math.max(0.2, pitchMult * pitchJitter);

      const gain = this.ctx.createGain();
      gain.gain.value = Math.max(0, Math.min(2.0, baseVolume * volumeJitter));

      source.connect(gain);

      if (position) {
        const panner = this.createPanner(position);
        if (panner) {
          gain.connect(panner);
          panner.connect(destGain);
        } else {
          gain.connect(destGain);
        }
      } else {
        gain.connect(destGain);
      }

      source.start();
    } catch {
      // Ignore any playback errors silently
    }
  }

  /**
   * The feet that land this frame, as left (false) or right (true). A body whose feet are tracked reports its
   * own landings; one without (a beast on four legs) steps by the ground it covers.
   */
  private footfalls(stride: Stride, body: SoundControllerLike, delta: number, steps: number | undefined): boolean[] {
    if (body.grounded === false || body.speed < 0.2) {
      stride.strideDistance = 0;
      return [];
    }
    if (steps !== undefined) return [...(steps & 1 ? [false] : []), ...(steps & 2 ? [true] : [])];
    const stepDistance = body.speed >= RUN_SPEED ? 1.48 : 0.485;
    stride.strideDistance += body.speed * delta;
    if (stride.strideDistance < stepDistance) return [];
    stride.strideDistance -= stepDistance;
    stride.lastStepRight = !stride.lastStepRight;
    return [stride.lastStepRight];
  }

  /** Hero footstep on a kind of ground, walk or run. */
  playFootstep(isRun = false, pitchMult = 1.0, family: StepFamily = 'stone'): void {
    this.playSample(this.stepCategory(family, isRun), isRun ? 1.0 : 0.85, pitchMult, this.footstepGain);
  }

  /** Stone, dirt and wood have walk and run recordings; the other grounds have one set, pushed harder for a run. */
  private stepCategory(family: StepFamily, isRun: boolean): string {
    return family === 'stone' || family === 'dirt' || family === 'wood'
      ? `footstep_${family}_${isRun ? 'run' : 'walk'}`
      : `footstep_${family}`;
  }

  /**
   * Speaks a recorded line in `voice`, from `position` when given, with music and ambience lowered while any
   * line plays. Each `channel` (a speaker) holds one line; a new one on the same channel cuts the old.
   * `admit` is asked with the line's length in seconds just before it starts and may refuse it.
   * Resolves false when the line has no recording or was refused, so callers can fall back to a bark.
   */
  async speak(voice: string, text: string, position?: SoundPosition,
    { channel = 'main', admit }: { channel?: string; admit?: (seconds: number) => boolean } = {}): Promise<boolean> {
    if (!this.ctx || !this.sfxGain || this.muted) return false;
    const manifest = await this.voiceIndex();
    const key = lineKey(text);
    if (!manifest?.[voice]?.[key]) return false;
    const buffer = await this.voiceBuffer(`/assets/voice/${voice}/${key}`);
    if (!buffer || !this.ctx || !this.sfxGain) return false;
    if (admit && !admit(buffer.duration)) return false;
    this.stopSpeech(channel);
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    const gain = this.ctx.createGain();
    gain.gain.value = VOICE_VOLUME;
    source.connect(gain);
    const panner = position ? this.createPanner(position) : null;
    if (panner) { gain.connect(panner); panner.connect(this.sfxGain); } else gain.connect(this.sfxGain);
    this.voices.set(channel, source);
    this.duck(true);
    source.onended = () => {
      if (this.voices.get(channel) !== source) return;
      this.voices.delete(channel);
      if (this.voices.size === 0) this.duck(false);
    };
    source.start();
    return true;
  }

  /** Cuts off the line on `channel`, or every line when none is named. */
  stopSpeech(channel?: string): void {
    for (const [name, source] of [...this.voices]) {
      if (channel !== undefined && name !== channel) continue;
      this.voices.delete(name);
      try { source.stop(); } catch { /* already ended */ }
    }
    if (this.voices.size === 0) this.duck(false);
  }

  private duck(down: boolean): void {
    if (!this.ctx) return;
    const level = down ? VOICE_DUCK : 1;
    for (const g of [this.ambientGain, this.musicGain]) g?.gain.setTargetAtTime(level, this.ctx.currentTime, 0.12);
  }

  private voiceIndex(): Promise<Record<string, Record<string, number>> | null> {
    this.voiceManifest ??= fetch('/assets/voice/manifest.json').then(r => (r.ok ? r.json() : null)).catch(() => null);
    return this.voiceManifest;
  }

  /** Opus first; a browser that cannot decode it gets the AAC copy from then on. */
  private async voiceBuffer(base: string): Promise<AudioBuffer | null> {
    for (const ext of this.voiceOpus === false ? ['.m4a'] : ['.ogg', '.m4a']) {
      try {
        const response = await fetch(base + ext);
        if (!response.ok || !this.ctx) continue;
        const buffer = await this.ctx.decodeAudioData(await response.arrayBuffer());
        if (ext === '.ogg') this.voiceOpus = true;
        return buffer;
      } catch {
        if (ext === '.ogg') this.voiceOpus = false;
      }
    }
    return null;
  }

  /** Short spoken bark for NPC interactions. */
  playBark(role = 'common', sex: 'male' | 'female' = 'male'): void {
    let category = sex === 'female' ? 'bark_female' : 'bark_male';
    if (role === 'guard') category = 'bark_guard';
    else if (role === 'smith') category = 'bark_smith';
    else if (role === 'innkeeper') category = 'bark_innkeeper';
    this.playSample(category, 0.95, 1.0, this.sfxGain);
  }

  /** Spatialized villain footstep, quieter. */
  playVillainFootstep(position: SoundPosition, isRun = false, pitchMult = 1.0, family: StepFamily = 'stone'): void {
    this.playSample(this.stepCategory(family, isRun), isRun ? 0.45 : 0.35, 0.95 * pitchMult, this.footstepGain, position);
  }

  /** Spatialized villain attack swing whoosh. */
  playVillainSwing(position: SoundPosition, isHeavy = false): void {
    this.playSample(isHeavy ? 'heavy_swing' : 'light_swing', isHeavy ? 0.75 : 0.60, 0.95, this.sfxGain, position);
  }

  /** Weapon or martial arts whoosh / swing sound. */
  playSwing(pitchMult = 1.0, isHeavy = false): void {
    this.playSample(isHeavy ? 'heavy_swing' : 'light_swing', isHeavy ? 0.95 : 0.75, pitchMult, this.sfxGain);
  }

  /** Impact on enemy: flesh slash, metal guard block, or lethal strike. */
  playImpact(isKilled = false, isBlocked = false): void {
    if (isBlocked) {
      this.playSample('hit_blocked', 0.9, 1.0, this.sfxGain);
    } else if (isKilled) {
      this.playSample('kill_blow', 1.1, 1.0, this.sfxGain);
      this.playThump(60, 0.35, 0.6);
    } else {
      this.playSample('hit_flesh', 0.85, 1.0, this.sfxGain);
    }
  }

  /** Low frequency thud / rumble for impacts and damage feedback. */
  playThump(_freq = 80, _duration = 0.2, volume = 0.4): void {
    this.playSample('thump', volume * 1.5, 1.0, this.sfxGain);
  }

  /** Fiery burst / elemental ignition sound. */
  playFireBurst(_duration = 0.4): void {
    this.playSample('fire_burst', 0.85, 1.0, this.sfxGain);
  }

  /** Ground slam shockwave eruption sound. */
  playGroundPound(): void {
    this.playSample('ground_pound', 1.1, 1.0, this.sfxGain);
  }

  /** Evasive roll whoosh with cloth rustle and scuff. */
  playDodge(): void {
    this.playSample('dodge', 0.8, 1.0, this.sfxGain);
  }

  /** Drawing blade from sheath with cloth and metal foley. */
  playDraw(): void {
    this.playSample('draw', 0.85, 1.0, this.sfxGain);
  }

  /** Sheathing blade into scabbard latch with cloth and metal foley. */
  playSheathe(): void {
    this.playSample('sheathe', 0.85, 1.0, this.sfxGain);
  }

  /** Hero taking hit damage / pain grunt. */
  playHeroHurt(): void {
    this.playSample('hero_hurt', 0.95, 1.0, this.sfxGain);
  }

  /** Villain being struck / flinching pain sound, spatialized. */
  playVillainHurt(position?: SoundPosition): void {
    this.playSample('villain_hurt', 0.95, 1.0, this.sfxGain, position);
  }

  /** Villain collapsing / death rattle, spatialized. */
  playVillainDeath(position?: SoundPosition): void {
    this.playSample('villain_death', 1.05, 1.0, this.sfxGain, position);
  }

  /**
   * Peak output level measurement across master output in dBFS.
   * Useful for clipping verification (peak < 0 dBFS).
   */
  getPeakLevel(): number {
    if (!this.analyser || !this.peakBuffer) return -100;
    this.analyser.getFloatTimeDomainData(this.peakBuffer);
    let max = 0;
    for (let i = 0; i < this.peakBuffer.length; i++) {
      const abs = Math.abs(this.peakBuffer[i] ?? 0);
      if (abs > max) max = abs;
    }
    if (max <= 1e-5) return -100;
    return 20 * Math.log10(max);
  }

  /** Returns true if the master output is at or above 0 dBFS (clipping). */
  isClipping(): boolean {
    return this.getPeakLevel() >= 0.0;
  }

  dispose(): void {
    this.events.abort();
    for (const s of this.ambientSources) {
      try { s.stop(); s.disconnect(); } catch { /* ignore */ }
    }
    this.ambientSources = [];
    this.ambientLayerGains = [];
    this.ambientActive = false;

    if (this.ctx) {
      this.ctx.close().catch(() => {});
      this.ctx = null;
    }
    this.buffers.clear();
    this.villainStates.clear();
  }
}
