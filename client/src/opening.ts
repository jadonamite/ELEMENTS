import {
  BODY_PRESET_OPTIONS,
  type CharacterConfig,
  CreatorView,
  getStoredCharacter,
  HAIR_COLOR_PRESETS,
  HAIR_STYLE_OPTIONS,
  SKIN_TONE_PRESETS,
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
import { roll } from '../../shared/src/rising/roll.js';
import { isTownMode } from './world-mode.js';

/**
 * Opening sequence: Age verification gate, character creation studio,
 * fake storefront purchase, reality glitch, and the Drawing raffle ceremony
 * (85% Shaper across the four elements, 15% Hush). With a game server a new player plays as a
 * guest: the server holds their Drawing, and they sign in at Sindr's gate (auth/save-progress.ts).
 */

export type DrawingResult =
  | { role: 'Hush'; element?: never }
  | { role: 'Shaper'; element: 'IGNIS' | 'AQUES' | 'TERRA' | 'AURA' };

const STORAGE_AGE_KEY = 'elements_age_gate';
const STORAGE_DRAWING_KEY = 'elements_drawing_result';

export function getStoredDrawing(): DrawingResult | null {
  try {
    const raw = localStorage.getItem(STORAGE_DRAWING_KEY);
    return raw ? (JSON.parse(raw) as DrawingResult) : null;
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
  private activeCreatorView: CreatorView | null = null;
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

  private cleanupSubviews(): void {
    if (this.activeCreatorView) {
      this.activeCreatorView.dispose();
      this.activeCreatorView = null;
    }
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
      } else {
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

  private proceedAfterLogin(): void {
    const char = getStoredCharacter();
    if (!char) {
      this.renderCharacterCreator();
    } else {
      this.renderStorefront();
    }
  }

  private renderCharacterCreator(): void {
    this.cleanupSubviews();
    this.activeCreatorView = new CreatorView(this.container, (config) => {
      this.activeCreatorView = null;
      this.onCharacter(config);
      this.renderStorefront();
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

  private renderStorefront(): void {
    this.cleanupSubviews();
    this.container.innerHTML = `
      <div class="opening-modal storefront">
        <div class="store-badge">New release</div>
        <h1 class="store-title">ELEMENTS</h1>
        <p class="store-tagline">Four nations, four elements, and a world that decides which one is yours.</p>
        <div class="store-details">
          <div class="store-card">
            <div class="store-edition">Standard edition</div>
            <div class="store-price">$0.00 <span>Free while in early access</span></div>
            <ul class="store-perks">
              <li>Fight with fire, water, earth or air</li>
              <li>Four nations to cross, each with its own masters</li>
              <li>Plays in your browser, nothing to install</li>
            </ul>
            <button type="button" id="buy-button" class="opening-button primary">Get the game</button>
          </div>
        </div>
        <div class="opening-footer">
          <span>By getting the game you agree to the <a href="/legal/terms.html" target="_blank">Terms</a> and <a href="/legal/privacy.html" target="_blank">Privacy Policy</a>.</span>
        </div>
      </div>
    `;

    const button = this.container.querySelector<HTMLButtonElement>('#buy-button')!;
    button.addEventListener('click', () => {
      this.triggerGlitchTransition();
    });
  }

  private triggerGlitchTransition(): void {
    this.cleanupSubviews();
    this.container.innerHTML = `
      <div class="glitch-screen">
        <div class="glitch-layer"></div>
        <div class="glitch-text">REALITY DESYNCHRONIZED...</div>
      </div>
    `;

    setTimeout(() => {
      void this.renderDrawingCeremony();
    }, 1200);
  }

  private async renderDrawingCeremony(): Promise<void> {
    this.cleanupSubviews();
    this.container.innerHTML = `
      <div class="opening-modal drawing-ceremony">
        <div class="ceremony-badge">The Lord's Drawing</div>
        <h2>Awakening...</h2>
        <p class="opening-subtitle">Your rising is being drawn.</p>
        <div class="login-loading-spinner"></div>
      </div>
    `;

    let result: DrawingResult;
    let isOfflineNotice = false;

    if (this.isOffline || isOfflineMode()) {
      result = performDrawingRoll();
      isOfflineNotice = true;
    } else {
      try {
        const token = this.authToken ?? getStoredAuthToken();
        result = token ? await postRising(token, getGuestTicket()) : await postGuestRising();
        if (token) clearGuestTicket();
        isOfflineNotice = false;
      } catch {
        // Fallback when server cannot be reached
        result = performDrawingRoll();
        isOfflineNotice = true;
      }
    }

    localStorage.setItem(STORAGE_DRAWING_KEY, JSON.stringify(result));
    this.displayDrawingResult(result, isOfflineNotice);
  }

  private displayDrawingResult(result: DrawingResult, isOfflineNotice: boolean): void {
    const title =
      result.role === 'Shaper'
        ? `You have awakened as a Shaper of ${result.element}`
        : 'You are Hush';

    const desc =
      result.role === 'Shaper'
        ? `Born with the innate gift of ${result.element}. Channel your elemental bending in armed combat and martial arts katas.`
        : 'Born without an element. Forge masterworks and relics from the shards of fallen beasts to arm the Lit.';

    const char = getStoredCharacter();
    const skinPreset = SKIN_TONE_PRESETS.find((p) => p.id === char?.skinToneId);
    const skinName = skinPreset?.name ?? 'Warm Bronze';
    const skinHex = skinPreset?.hex ?? '#956344';
    const hairStyle =
      HAIR_STYLE_OPTIONS.find((h) => h.id === char?.hairStyleId)?.name ?? 'Parted';
    const hairColor =
      HAIR_COLOR_PRESETS.find((c) => c.id === char?.hairColorId)?.name ??
      'Espresso Brown';
    const bodyPreset =
      BODY_PRESET_OPTIONS.find((b) => b.id === char?.bodyPreset)?.name ?? 'Average';

    this.container.innerHTML = `
      <div class="opening-modal drawing-ceremony">
        <div class="ceremony-badge">The Lord's Drawing</div>
        ${
          isOfflineNotice
            ? '<p class="ceremony-offline-note">offline: progress is not saved</p>'
            : ''
        }
        <div class="drawing-character-card">
          <div class="drawing-char-avatar" style="border-color: ${skinHex};">
            <span class="drawing-avatar-sex">${char?.sex === 'female' ? 'Female' : 'Male'}</span>
          </div>
          <div class="drawing-char-meta">
            <div class="drawing-char-archetype">${char?.sex === 'female' ? 'Female' : 'Male'} Hero · ${bodyPreset} Build</div>
            <div class="drawing-char-traits">${skinName} · ${hairStyle} · ${hairColor}</div>
          </div>
        </div>
        <h2 class="ceremony-result ${result.role === 'Shaper' ? result.element.toLowerCase() : 'hush'}">${title}</h2>
        <p class="ceremony-desc">${desc}</p>
        <button type="button" id="enter-arena-button" class="opening-button primary">${isTownMode(new URLSearchParams(window.location.search)) ? 'Enter Sindr' : 'Enter the arena'}</button>
      </div>
    `;

    const enterBtn = this.container.querySelector<HTMLButtonElement>('#enter-arena-button')!;
    enterBtn.addEventListener('click', () => {
      this.close(result);
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
    this.container.remove();
  }
}
