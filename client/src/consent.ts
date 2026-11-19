/**
 * Consent banner: Informs player of necessary local storage usage with links
 * to Terms, Privacy, and Cookie policies, adhering to GDPR/ePrivacy requirements.
 */

const STORAGE_CONSENT_KEY = 'elements_consent_accepted';

export class ConsentBanner {
  private element: HTMLDivElement | null = null;
  private resize: ResizeObserver | null = null;

  constructor() {
    if (typeof window === 'undefined') return;
    if (['true', 'declined'].includes(localStorage.getItem(STORAGE_CONSENT_KEY) ?? '')) return;
    this.render();
  }

  private render(): void {
    this.element = document.createElement('div');
    this.element.id = 'consent-banner';
    this.element.innerHTML = `
      <div class="consent-content">
        <p>ELEMENTS uses only strictly necessary local storage to manage your game state and preferences. No third-party tracking or advertising cookies are used.</p>
        <div class="consent-actions">
          <a href="/legal/privacy.html" target="_blank" rel="noopener">Privacy</a>
          <a href="/legal/cookies.html" target="_blank" rel="noopener">Cookies</a>
          <button type="button" id="consent-accept-btn" class="consent-btn">Accept</button>
          <button type="button" id="consent-decline-btn" class="consent-btn">Decline optional</button>
        </div>
      </div>
    `;

    document.body.appendChild(this.element);
    // Full-screen layers end above the banner while it is up, so it never covers their buttons.
    this.resize = new ResizeObserver(() => {
      if (this.element) document.documentElement.style.setProperty('--consent-h', `${this.element.offsetHeight}px`);
    });
    this.resize.observe(this.element);

    const btn = this.element.querySelector<HTMLButtonElement>('#consent-accept-btn');
    btn?.addEventListener('click', () => {
      localStorage.setItem(STORAGE_CONSENT_KEY, 'true');
      this.close();
    });
    this.element.querySelector('#consent-decline-btn')?.addEventListener('click', () => {
      localStorage.setItem(STORAGE_CONSENT_KEY, 'declined');
      this.close();
    });
  }

  private close(): void {
    this.resize?.disconnect();
    this.resize = null;
    this.element?.remove();
    this.element = null;
    document.documentElement.style.removeProperty('--consent-h');
  }

  dispose(): void {
    this.close();
  }
}
