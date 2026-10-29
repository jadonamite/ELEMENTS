/**
 * Opening sequence: Age verification gate, fake storefront purchase, reality glitch,
 * and the Drawing raffle ceremony (85% Shaper across the four elements, 15% Hush).
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
  const roll = Math.random();
  if (roll < 0.15) {
    return { role: 'Hush' };
  }
  const elements = ['IGNIS', 'AQUES', 'TERRA', 'AURA'] as const;
  const elementIndex = Math.floor(Math.random() * elements.length);
  const element = elements[elementIndex]!;
  return { role: 'Shaper', element };
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

  constructor(onComplete: (result: DrawingResult) => void) {
    this.onComplete = onComplete;
    this.container = document.createElement('div');
    this.container.id = 'opening-overlay';
    document.body.appendChild(this.container);

    this.start();
  }

  private start(): void {
    // If player already completed age gate and drawing, immediately finish
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
    } else {
      this.renderStorefront();
    }
  }

  private renderAgeGate(): void {
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
          <a href="/legal/terms" target="_blank">Terms</a>
          <a href="/legal/privacy" target="_blank">Privacy</a>
          <a href="/legal/cookies" target="_blank">Cookies</a>
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
        this.renderStorefront();
      }
    });
  }

  private renderAgeBlocked(): void {
    this.container.innerHTML = `
      <div class="opening-modal age-blocked">
        <h2>Access Restricted</h2>
        <p>You do not meet the minimum age requirement (13) to play ELEMENTS.</p>
        <p class="opening-subtext">This check is permanent for this device.</p>
      </div>
    `;
  }

  private renderStorefront(): void {
    this.container.innerHTML = `
      <div class="opening-modal storefront">
        <div class="store-badge">NEAR Testnet Release</div>
        <h1 class="store-title">ELEMENTS</h1>
        <p class="store-tagline">A tactical on-chain ARPG of Shapers, relics, and sovereign economy.</p>
        <div class="store-details">
          <div class="store-card">
            <div class="store-edition">Standard Edition</div>
            <div class="store-price">$0.00 <span>(Free for Hackathon Review)</span></div>
            <ul class="store-perks">
              <li>Full arena access & IGNIS combat</li>
              <li>Permanent on-chain Drawing raffle entry</li>
              <li>Zero-friction embedded NEAR testnet account</li>
            </ul>
            <button type="button" id="buy-button" class="opening-button primary">Claim Game Copy</button>
          </div>
        </div>
        <div class="opening-footer">
          <span>By claiming you agree to the <a href="/legal/terms" target="_blank">Terms</a> and <a href="/legal/privacy" target="_blank">Privacy Policy</a>.</span>
        </div>
      </div>
    `;

    const button = this.container.querySelector<HTMLButtonElement>('#buy-button')!;
    button.addEventListener('click', () => {
      this.triggerGlitchTransition();
    });
  }

  private triggerGlitchTransition(): void {
    this.container.innerHTML = `
      <div class="glitch-screen">
        <div class="glitch-layer"></div>
        <div class="glitch-text">REALITY DESYNCHRONIZED...</div>
      </div>
    `;

    setTimeout(() => {
      this.renderDrawingCeremony();
    }, 1200);
  }

  private renderDrawingCeremony(): void {
    const result = performDrawingRoll();
    localStorage.setItem(STORAGE_DRAWING_KEY, JSON.stringify(result));

    const title = result.role === 'Shaper'
      ? `You have awakened as a Shaper of ${result.element}`
      : 'You are Hush';

    const desc = result.role === 'Shaper'
      ? `Born with the innate gift of ${result.element}. Channel your elemental bending in armed combat and martial arts katas.`
      : 'Born without an element. Forge masterworks and relics from the shards of fallen beasts to arm the Lit.';

    this.container.innerHTML = `
      <div class="opening-modal drawing-ceremony">
        <div class="ceremony-badge">The Lord's Drawing</div>
        <h2 class="ceremony-result ${result.role === 'Shaper' ? (result.element?.toLowerCase() ?? '') : 'hush'}">${title}</h2>
        <p class="ceremony-desc">${desc}</p>
        <button type="button" id="enter-arena-button" class="opening-button primary">Enter the Arena</button>
      </div>
    `;

    const enterBtn = this.container.querySelector<HTMLButtonElement>('#enter-arena-button')!;
    enterBtn.addEventListener('click', () => {
      this.close(result);
    });
  }

  private close(result: DrawingResult): void {
    this.container.classList.add('fade-out');
    setTimeout(() => {
      this.container.remove();
      this.onComplete(result);
    }, 400);
  }

  dispose(): void {
    this.container.remove();
  }
}
