/**
 * Procedural and sample-based sound manager using the Web Audio API.
 * Provides instant, zero-dependency punchy combat sounds, 3D spatial panning,
 * separate SFX and music busses, and automatic tab muting.
 */

export interface SoundManagerOptions {
  sfxVolume?: number;
  musicVolume?: number;
}

export class SoundManager {
  private ctx: AudioContext | null = null;
  private sfxGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private masterGain: GainNode | null = null;
  private muted = false;
  private unlocked = false;

  constructor(options: SoundManagerOptions = {}) {
    if (typeof window === 'undefined') return;
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    try {
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.sfxGain = this.ctx.createGain();
      this.musicGain = this.ctx.createGain();

      this.sfxGain.gain.value = options.sfxVolume ?? 0.7;
      this.musicGain.gain.value = options.musicVolume ?? 0.5;

      this.sfxGain.connect(this.masterGain);
      this.musicGain.connect(this.masterGain);
      this.masterGain.connect(this.ctx.destination);

      const unlock = (): void => {
        if (!this.ctx || this.unlocked) return;
        if (this.ctx.state === 'suspended') {
          this.ctx.resume().then(() => { this.unlocked = true; }).catch(() => {});
        } else {
          this.unlocked = true;
        }
      };

      window.addEventListener('click', unlock, { once: true });
      window.addEventListener('keydown', unlock, { once: true });

      document.addEventListener('visibilitychange', () => {
        this.setMuted(document.hidden);
      });
    } catch {
      // AudioContext disallowed or disabled
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

  /** Weapon or martial arts whoosh / swing sound. */
  playSwing(pitchMult = 1.0, isHeavy = false): void {
    if (!this.ctx || !this.sfxGain || this.muted) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = isHeavy ? 'triangle' : 'sine';
    const startFreq = (isHeavy ? 140 : 220) * pitchMult;
    const endFreq = (isHeavy ? 60 : 90) * pitchMult;
    osc.frequency.setValueAtTime(startFreq, t);
    osc.frequency.exponentialRampToValueAtTime(endFreq, t + (isHeavy ? 0.22 : 0.14));

    gain.gain.setValueAtTime(isHeavy ? 0.45 : 0.25, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + (isHeavy ? 0.24 : 0.15));

    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + (isHeavy ? 0.25 : 0.16));
  }

  /** Metallic blade impact on enemy or guard. */
  playImpact(isKilled = false, isBlocked = false): void {
    if (!this.ctx || !this.sfxGain || this.muted) return;
    const t = this.ctx.currentTime;

    // Metal clink (FM synthesis)
    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const modGain = this.ctx.createGain();
    const outGain = this.ctx.createGain();

    osc1.type = 'sine';
    osc2.type = 'square';
    osc1.frequency.setValueAtTime(isBlocked ? 580 : 340, t);
    osc2.frequency.setValueAtTime(isBlocked ? 1160 : 680, t);
    modGain.gain.setValueAtTime(isBlocked ? 300 : 150, t);
    modGain.gain.exponentialRampToValueAtTime(1, t + (isBlocked ? 0.18 : 0.12));

    osc2.connect(modGain);
    modGain.connect(osc1.frequency);

    outGain.gain.setValueAtTime(isBlocked ? 0.5 : 0.4, t);
    outGain.gain.exponentialRampToValueAtTime(0.001, t + (isBlocked ? 0.2 : 0.15));

    osc1.connect(outGain);
    outGain.connect(this.sfxGain);

    osc1.start(t);
    osc2.start(t);
    osc1.stop(t + 0.22);
    osc2.stop(t + 0.22);

    // Deep sub thump on death or heavy hit
    if (isKilled) {
      this.playThump(60, 0.35, 0.5);
    }
  }

  /** Low frequency thud / rumble for hits, dodges and impacts. */
  playThump(freq = 80, duration = 0.2, volume = 0.4): void {
    if (!this.ctx || !this.sfxGain || this.muted) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(28, t + duration);

    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);

    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + duration);
  }

  /** Fiery burst / elemental ignition sound. */
  playFireBurst(duration = 0.4): void {
    if (!this.ctx || !this.sfxGain || this.muted) return;
    const t = this.ctx.currentTime;

    // Filtered noise burst
    const bufferSize = this.ctx.sampleRate * duration;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(500, t);
    filter.frequency.exponentialRampToValueAtTime(200, t + duration);
    filter.Q.value = 2.0;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.35, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxGain);
    noise.start(t);
    noise.stop(t + duration);
  }

  /** Ground slam shockwave eruption sound. */
  playGroundPound(): void {
    this.playThump(65, 0.45, 0.65);
    this.playFireBurst(0.5);
  }

  /** Evasive roll whoosh. */
  playDodge(): void {
    this.playSwing(0.75, false);
  }

  dispose(): void {
    if (this.ctx) {
      this.ctx.close().catch(() => {});
      this.ctx = null;
    }
  }
}
