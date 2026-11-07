import {
  BODY_PRESET_OPTIONS,
  CreatorView,
  getStoredCharacter,
  HAIR_COLOR_PRESETS,
  HAIR_STYLE_OPTIONS,
  SKIN_TONE_PRESETS,
} from './creator/index.js';
import {
  getStoredAuthToken,
  isOfflineMode,
  mountLoginIsland,
  postRising,
  postSession,
} from './auth/index.js';
import { roll } from '../../shared/src/rising/roll.js';
import { isTownMode } from './world-mode.js';

/**
 * Opening sequence: Age verification gate, character creation studio,
 * fake storefront purchase, reality glitch, and the Drawing raffle ceremony
 * (85% Shaper across the four elements, 15% Hush).
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
  const birth = new Date(dobString);
  if (isNaN(birth.getTime())) return -1;
  let age = referenceDate.getFullYear() - birth.getFullYear();
  const m = referenceDate.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && referenceDate.getDate() < birth.getDate())) {
    age--;
  }
  return age;
}

export class OpeningFlow {
  private readonly container: HTMLDivElement;
  private readonly onComplete: (result: DrawingResult) => void;
  private activeCreatorView: CreatorView | null = null;
  private activeLoginIsland: { unmount: () => void } | null = null;
  private authToken: string | null = null;
  private accountId: string | null = null;
  private isOffline = false;

  constructor(onComplete: (result: DrawingResult) => void) {
    this.onComplete = onComplete;
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
    const saved = getStoredDrawing();
    const ageState = localStorage.getItem(STORAGE_AGE_KEY);

    if (ageState === 'under') {
      this.renderAgeBlocked();
      return;
    }

    if (saved && ageState === 'over') {
      this.close(saved);
      return;
    }

    if (ageState !== 'over') {
      this.renderAgeGate();
      return;
    }

    if (isOfflineMode()) {
      this.isOffline = true;
      this.proceedAfterLogin();
      return;
    }

    const token = getStoredAuthToken();
    if (token) {
      void this.attemptSessionResume(token);
      return;
    }

    this.renderLoginStep();
  }

  private async attemptSessionResume(token: string): Promise<void> {
    try {
      const session = await postSession(token);
      this.authToken = token;
      this.accountId = session.accountId;
      if (session.rising) {
        localStorage.setItem(STORAGE_DRAWING_KEY, JSON.stringify(session.rising));
        this.close(session.rising);
        return;
      }
      this.proceedAfterLogin();
    } catch {
      this.renderLoginStep();
    }
  }

  private renderAgeGate(): void {
    this.cleanupSubviews();
    this.container.innerHTML = `
      <div class="opening-modal age-gate">
        <h2>Welcome to ELEMENTS</h2>
        <p class="opening-subtitle">Please enter your date of birth to continue.</p>
        <form id="age-form" class="opening-form">
          <div class="form-group">
            <label for="dob">Date of Birth</label>
            <input type="date" id="dob" required max="2026-10-29" />
          </div>
          <button type="submit" class="opening-button">Continue</button>
          <p id="age-error" class="opening-error" role="alert"></p>
        </form>
        <div class="opening-footer">
          <a href="/legal/terms.html" target="_blank">Terms</a>
          <a href="/legal/privacy.html" target="_blank">Privacy</a>
          <a href="/legal/cookies.html" target="_blank">Cookies</a>
        </div>
      </div>
    `;

    const form = this.container.querySelector<HTMLFormElement>('#age-form')!;
    const input = this.container.querySelector<HTMLInputElement>('#dob')!;
    const error = this.container.querySelector<HTMLParagraphElement>('#age-error')!;

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const val = input.value;
      if (!val) return;
      const age = calculateAge(val);
      if (age < 0) {
        error.textContent = 'Please enter a valid date.';
        return;
      }
      if (age < 13) {
        localStorage.setItem(STORAGE_AGE_KEY, 'under');
        this.renderAgeBlocked();
      } else {
        localStorage.setItem(STORAGE_AGE_KEY, 'over');
        if (isOfflineMode()) {
          this.isOffline = true;
          this.proceedAfterLogin();
        } else {
          this.renderLoginStep();
        }
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
    this.activeCreatorView = new CreatorView(this.container, () => {
      this.activeCreatorView = null;
      this.renderStorefront();
    });
  }

  private renderAgeBlocked(): void {
    this.cleanupSubviews();
    this.container.innerHTML = `
      <div class="opening-modal age-blocked">
        <h2>Access Restricted</h2>
        <p>You do not meet the minimum age requirement (13) to play ELEMENTS.</p>
        <p class="opening-subtext">This check is permanent for this device.</p>
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
        result = await postRising(token ?? undefined);
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
