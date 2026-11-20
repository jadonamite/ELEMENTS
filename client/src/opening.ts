import {
  type CharacterConfig,
  getDefaultCharacterConfig,
  saveStoredCharacter,
  type Sex,
} from './creator/index.js';
import {
  clearGuestTicket,
  getGuestTicket,
  getStoredAuthToken,
  hasGameServer,
  isOfflineMode,
  mountLoginIsland,
  postGuestRising,
  postRising,
  postSession,
} from './auth/index.js';
import { drawNation, roll } from '../../shared/src/rising/roll.js';
import type { RisingResult } from '../../shared/src/rising/types.js';
import { playDrawingReveal, prepareDrawing, type DrawingKit } from './opening/drawing-reveal.js';
import { compilesSettled, holdTurns } from './world/warmup.js';
import { fadeVolume } from './opening/fade.js';

/** How long the Drawing's score takes to fall silent after the player chooses who rises. */
const MUSIC_FADE_OUT_MS = 1800;

/**
 * Opening sequence, from Play Now: the age check, the opening film, the Drawing (85% Shaper across the four
 * elements, 15% Hush, who draw again for a nation), then the player chooses who rises. With a game server a new
 * player plays as a guest: the server holds their Drawing, and they sign in at Sindr's gate (auth/save-progress.ts).
 */

export type DrawingResult = RisingResult;

const STORAGE_AGE_KEY = 'elements_age_gate';
/** Set when the player agreed to the Terms and Privacy Policy at the age check. */
const STORAGE_AGREED_KEY = 'elements_consent_accepted';
const STORAGE_DRAWING_KEY = 'elements_drawing_result';

export function getStoredDrawing(): DrawingResult | null {
  try {
    const raw = localStorage.getItem(STORAGE_DRAWING_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as DrawingResult;
    if (saved.role === 'Hush' && !saved.element) {
      // A Hush saved before the nation draw existed draws it once and keeps it.
      saved.element = drawNation();
      localStorage.setItem(STORAGE_DRAWING_KEY, JSON.stringify(saved));
    }
    return saved;
  } catch {
    return null;
  }
}

export function performDrawingRoll(): DrawingResult {
  return roll();
}

export function calculateAge(dobString: string, referenceDate = new Date()): number {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dobString);
  const birth = parts ? new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3])) : new Date(dobString);
  if (isNaN(birth.getTime())) return -1;
  let age = referenceDate.getFullYear() - birth.getFullYear();
  const m = referenceDate.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && referenceDate.getDate() < birth.getDate())) {
    age--;
  }
  return age;
}

export type BirthDate =
  | { ok: true; iso: string }
  | { ok: false; field: 'day' | 'month' | 'year'; message: string };

/** Day, month and year as typed into the age check; a real date that has already happened. */
export function parseBirthDate(day: string, month: string, year: string, today = new Date()): BirthDate {
  const d = Number(day), m = Number(month), y = Number(year);
  if (!day && !month && !year) return { ok: false, field: 'day', message: 'Enter your date of birth.' };
  if (!d || d < 1 || d > 31) return { ok: false, field: 'day', message: 'Enter the day of the month.' };
  if (!m || m < 1 || m > 12) return { ok: false, field: 'month', message: 'Choose a month.' };
  if (!/^\d{4}$/.test(year) || y < 1900 || y > today.getFullYear()) return { ok: false, field: 'year', message: 'Enter the year as four digits.' };
  const date = new Date(y, m - 1, d);
  if (date.getDate() !== d || date.getMonth() !== m - 1) return { ok: false, field: 'day', message: 'That day isn\'t in that month.' };
  if (date > today) return { ok: false, field: 'year', message: 'That date hasn\'t happened yet.' };
  const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return { ok: true, iso };
}

export class OpeningFlow {
  private readonly container: HTMLDivElement;
  private readonly onComplete: (result: DrawingResult) => void;
  private readonly onCharacter: (config: CharacterConfig) => void;
  private music: HTMLAudioElement | null = null;
  private drawingKit: DrawingKit | null = null;
  /** What the opening has on screen over the world: the film, the Drawing, or nothing the world must yield to. */
  private showing: 'film' | 'drawing' | null = null;
  private rising: Promise<{ result: DrawingResult; offline: boolean }> | null = null;
  private activeLoginIsland: { unmount: () => void } | null = null;
  private authToken: string | null = null;
  private accountId: string | null = null;
  private isOffline = false;

  /** `onCharacter` runs when the creator saves a character, so the hero can wear it before the town opens. */
  constructor(onComplete: (result: DrawingResult) => void, onCharacter: (config: CharacterConfig) => void = () => {}) {
    this.onComplete = onComplete;
    this.onCharacter = onCharacter;
    this.container = document.createElement('div');
    this.container.id = 'opening-overlay';
    document.body.appendChild(this.container);

    this.start();
  }

  /** The world draws sparingly under the film and not at all under the Drawing, which keeps time to its score. */
  get covering(): 'film' | 'drawing' | null {
    return this.showing;
  }

  private cleanupSubviews(): void {
    if (this.activeLoginIsland) {
      this.activeLoginIsland.unmount();
      this.activeLoginIsland = null;
    }
  }

  private start(): void {
    const ageState = localStorage.getItem(STORAGE_AGE_KEY);
    if (ageState === 'under') {
      this.renderAgeBlocked();
      return;
    }
    if (ageState !== 'over') {
      this.renderAgeGate();
      return;
    }
    this.afterAgeGate();
  }

  /**
   * A signed-in player resumes their account. A new player goes on as a guest and signs in at
   * Sindr's gate; a guest who comes back resumes the Drawing the server holds for their ticket.
   */
  private afterAgeGate(): void {
    if (isOfflineMode() || !hasGameServer()) {
      this.isOffline = true;
      const saved = getStoredDrawing();
      if (saved) this.close(saved);
      else this.proceedAfterLogin();
      return;
    }

    const token = getStoredAuthToken();
    if (token) {
      void this.attemptSessionResume(token);
      return;
    }

    const saved = getStoredDrawing();
    if (saved && getGuestTicket()) {
      this.close(saved);
      return;
    }
    this.proceedAfterLogin();
  }

  private async attemptSessionResume(token: string): Promise<void> {
    try {
      const session = await postSession(token);
      if (session.grantContracts?.length) {
        this.renderLoginStep();
        return;
      }
      this.authToken = token;
      this.accountId = session.accountId;
      if (session.rising) {
        clearGuestTicket();
        localStorage.setItem(STORAGE_DRAWING_KEY, JSON.stringify(session.rising));
        this.close(session.rising);
        return;
      }
      const ticket = getGuestTicket();
      if (ticket) {
        const claimed = await postRising(token, ticket);
        clearGuestTicket();
        localStorage.setItem(STORAGE_DRAWING_KEY, JSON.stringify(claimed));
        this.close(claimed);
        return;
      }
      this.proceedAfterLogin();
    } catch {
      this.renderLoginStep();
    }
  }

  private renderAgeGate(): void {
    this.cleanupSubviews();
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    this.container.innerHTML = `
      <div class="opening-modal age-gate" role="dialog" aria-modal="true" aria-labelledby="age-title">
        <p class="opening-kicker">Before you enter</p>
        <h2 id="age-title">When were you born?</h2>
        <p class="opening-subtitle">We only keep whether you can play, never the date.</p>
        <form id="age-form" class="opening-form" novalidate>
          <fieldset class="opening-date">
            <legend>Date of birth</legend>
            <div class="form-group">
              <label for="dob-day">Day</label>
              <input id="dob-day" name="day" inputmode="numeric" autocomplete="bday-day" maxlength="2" placeholder="DD" required />
            </div>
            <div class="form-group">
              <label for="dob-month">Month</label>
              <select id="dob-month" name="month" autocomplete="bday-month" required>
                <option value="" selected disabled>Month</option>
                ${months.map((m, i) => `<option value="${i + 1}">${m}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label for="dob-year">Year</label>
              <input id="dob-year" name="year" inputmode="numeric" autocomplete="bday-year" maxlength="4" placeholder="YYYY" required />
            </div>
          </fieldset>
          <label class="opening-agree">
            <input type="checkbox" id="age-agree" required />
            <span>I agree to the <a href="/legal/terms.html" target="_blank" rel="noopener">Terms</a> and <a href="/legal/privacy.html" target="_blank" rel="noopener">Privacy Policy</a>, and to ELEMENTS keeping what the game needs on this device.</span>
          </label>
          <p id="age-error" class="opening-error" role="alert"></p>
          <button type="submit" class="opening-button primary">Continue</button>
        </form>
        <nav class="opening-footer" aria-label="Legal">
          <a href="/legal/terms.html" target="_blank" rel="noopener">Terms</a>
          <a href="/legal/privacy.html" target="_blank" rel="noopener">Privacy</a>
          <a href="/legal/cookies.html" target="_blank" rel="noopener">Cookies</a>
        </nav>
      </div>
    `;

    const form = this.container.querySelector<HTMLFormElement>('#age-form')!;
    const day = this.container.querySelector<HTMLInputElement>('#dob-day')!;
    const month = this.container.querySelector<HTMLSelectElement>('#dob-month')!;
    const year = this.container.querySelector<HTMLInputElement>('#dob-year')!;
    const error = this.container.querySelector<HTMLParagraphElement>('#age-error')!;
    const agree = this.container.querySelector<HTMLInputElement>('#age-agree')!;
    agree.addEventListener('change', () => { if (agree.checked) { agree.setAttribute('aria-invalid', 'false'); error.textContent = ''; } });
    const digitsOnly = (input: HTMLInputElement): void => { input.value = input.value.replace(/\D/g, ''); };
    day.addEventListener('input', () => { digitsOnly(day); if (day.value.length === 2) month.focus(); });
    month.addEventListener('change', () => year.focus());
    year.addEventListener('input', () => digitsOnly(year));
    day.focus({ preventScroll: true });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const dob = parseBirthDate(day.value, month.value, year.value);
      const fields: Array<[HTMLInputElement | HTMLSelectElement, boolean]> = [
        [day, !dob.ok && dob.field === 'day'], [month, !dob.ok && dob.field === 'month'], [year, !dob.ok && dob.field === 'year'],
      ];
      for (const [field, bad] of fields) field.setAttribute('aria-invalid', String(bad));
      if (!dob.ok) {
        error.textContent = dob.message;
        fields.find(([, bad]) => bad)?.[0].focus();
        return;
      }
      if (calculateAge(dob.iso) < 13) {
        localStorage.setItem(STORAGE_AGE_KEY, 'under');
        this.renderAgeBlocked();
      } else if (!agree.checked) {
        agree.setAttribute('aria-invalid', 'true');
        error.textContent = 'Tick the box to agree before you continue.';
        agree.focus();
      } else {
        localStorage.setItem(STORAGE_AGREED_KEY, 'true');
        localStorage.setItem(STORAGE_AGE_KEY, 'over');
        this.afterAgeGate();
      }
    });
  }

  private renderLoginStep(): void {
    this.cleanupSubviews();
    this.container.innerHTML = `<div id="login-island-host"></div>`;
    const host = this.container.querySelector<HTMLDivElement>('#login-island-host')!;

    this.activeLoginIsland = mountLoginIsland(host, {
      onSuccess: (payload) => {
        this.cleanupSubviews();
        this.authToken = payload.token;
        this.accountId = payload.accountId;

        if (payload.rising) {
          localStorage.setItem(STORAGE_DRAWING_KEY, JSON.stringify(payload.rising));
          this.close(payload.rising);
          return;
        }

        this.proceedAfterLogin();
      },
      onOffline: () => {
        this.cleanupSubviews();
        this.isOffline = true;
        this.proceedAfterLogin();
      },
    });
  }

  private renderAgeBlocked(): void {
    this.cleanupSubviews();
    this.container.innerHTML = `
      <div class="opening-modal age-blocked" role="dialog" aria-modal="true" aria-labelledby="age-blocked-title">
        <p class="opening-kicker">ELEMENTS</p>
        <h2 id="age-blocked-title">Not yet</h2>
        <p class="opening-subtitle">ELEMENTS isn't available to you on this device.</p>
        <nav class="opening-footer" aria-label="Legal">
          <a href="/legal/terms.html" target="_blank" rel="noopener">Terms</a>
          <a href="/legal/privacy.html" target="_blank" rel="noopener">Privacy</a>
        </nav>
      </div>
    `;
  }

  private proceedAfterLogin(): void {
    this.rising = this.drawRising();
    this.renderFilm();
  }

  /** The server rolls a guest's or account's Drawing; offline, or if it cannot be reached, the browser rolls it. */
  private async drawRising(): Promise<{ result: DrawingResult; offline: boolean }> {
    if (this.isOffline || isOfflineMode()) return { result: performDrawingRoll(), offline: true };
    try {
      const token = this.authToken ?? getStoredAuthToken();
      const result = token ? await postRising(token, getGuestTicket()) : await postGuestRising();
      if (token) clearGuestTicket();
      return { result, offline: false };
    } catch {
      return { result: performDrawingRoll(), offline: true };
    }
  }

  /** The opening film, start to finish. It hands over to the Drawing as the elements surge. */
  private renderFilm(): void {
    this.cleanupSubviews();
    const small = window.matchMedia('(max-width: 900px)').matches;
    this.container.innerHTML = `
      <div class="opening-film">
        <video class="opening-film-video" playsinline preload="auto" src="/assets/film/opening-${small ? 960 : 1470}.mp4" aria-label="The opening film"></video>
        <button type="button" class="opening-button opening-film-begin" hidden>Begin</button>
      </div>`;
    this.container.classList.add('is-film');
    this.showing = 'film';
    const video = this.container.querySelector<HTMLVideoElement>('video')!;
    const begin = this.container.querySelector<HTMLButtonElement>('.opening-film-begin')!;
    // The Drawing's art, score and drawn clip load during the film: once the film has enough to play through, or
    // in its last 30 seconds if it never does, so they never take its bandwidth at the start.
    const rising = (this.rising ??= this.drawRising());
    const prepare = (): void => {
      if (this.drawingKit) return;
      this.drawingKit = prepareDrawing(rising.then(r => r.result));
      this.music = this.drawingKit.music;
    };
    video.addEventListener('canplaythrough', prepare, { once: true });
    video.addEventListener('timeupdate', () => { if (video.duration - video.currentTime < 30) prepare(); });
    let handed = false;
    const handOver = (): void => {
      if (handed) return;
      handed = true;
      prepare();
      this.container.classList.remove('is-film');
      void this.renderDrawing();
    };
    video.addEventListener('ended', handOver, { once: true });
    // A film that cannot load never strands the player before their Drawing.
    video.addEventListener('error', handOver, { once: true });
    const play = (): void => {
      video.play().then(() => { begin.hidden = true; }).catch(() => {
        // The browser wants a fresh tap before sound plays.
        begin.hidden = false;
        begin.focus({ preventScroll: true });
      });
    };
    begin.addEventListener('click', play);
    play();
  }

  private async renderDrawing(): Promise<void> {
    this.cleanupSubviews();
    const { result, offline } = await (this.rising ?? this.drawRising());
    localStorage.setItem(STORAGE_DRAWING_KEY, JSON.stringify(result));
    const kit = this.drawingKit ?? prepareDrawing(result);
    this.music = kit.music;
    this.showing = 'drawing';
    // The world's heavy work waits for the reveal, which starts once compiles already on the GPU are done.
    let revealed: () => void = () => {};
    holdTurns(new Promise<void>(resolve => { revealed = resolve; }));
    const reveal = playDrawingReveal(this.container, result, {
      reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      kit,
      quiet: compilesSettled(),
    }).finally(revealed);
    await reveal;
    this.renderRiseChoice(result, offline);
  }

  /** Who rises: a default man or woman for now; the full creator comes back later. */
  private renderRiseChoice(result: DrawingResult, offline: boolean): void {
    const after = this.container.querySelector<HTMLElement>('.draw-after');
    if (!after) return;
    after.innerHTML = `
      <div class="rise-choice" role="group" aria-labelledby="rise-choice-label">
        <p class="opening-kicker" id="rise-choice-label">Who rises</p>
        <div class="rise-choice-buttons">
          <button type="button" class="opening-button" data-sex="male">A man</button>
          <button type="button" class="opening-button" data-sex="female">A woman</button>
        </div>
        ${offline ? '<p class="opening-subtext">Offline: this Drawing is not saved.</p>' : ''}
      </div>`;
    after.querySelector<HTMLButtonElement>('button')!.focus({ preventScroll: true });
    after.querySelectorAll<HTMLButtonElement>('button[data-sex]').forEach(button => {
      button.addEventListener('click', () => {
        const config = getDefaultCharacterConfig(button.dataset.sex as Sex);
        saveStoredCharacter(config);
        this.onCharacter(config);
        this.container.querySelector('.draw-stage')?.classList.add('leaving');
        this.showing = null;
        // The score is gone before the world opens: the game starts in its own sound, never under the music.
        const music = this.music;
        if (!music) { setTimeout(() => this.close(result), 1200); return; }
        void fadeVolume(music, 0, MUSIC_FADE_OUT_MS).then(() => { music.pause(); this.close(result); });
      }, { once: true });
    });
  }

  private close(result: DrawingResult): void {
    this.cleanupSubviews();
    this.container.classList.add('fade-out');
    setTimeout(() => {
      this.container.remove();
      this.onComplete(result);
    }, 400);
  }

  dispose(): void {
    this.cleanupSubviews();
    this.music?.pause();
    this.container.remove();
  }
}
