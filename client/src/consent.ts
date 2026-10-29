/**
 * Consent banner: Informs player of necessary local storage usage with links
 * to Terms, Privacy, and Cookie policies, adhering to GDPR/ePrivacy requirements.
 */

const STORAGE_CONSENT_KEY = 'elements_consent_accepted';

export class ConsentBanner {
  private element: HTMLDivElement | null = null;

  constructor() {
    if (typeof window === 'undefined') return;
    if (localStorage.getItem(STORAGE_CONSENT_KEY) === 'true') return;
    this.render();
  }

  private render(): void {
    this.element = document.createElement('div');
    this.element.id = 'consent-banner';
    this.element.innerHTML = `
      <div class="consent-content">
        <p>ELEMENTS uses only strictly necessary local storage to manage your game state and preferences. No third-party tracking or advertising cookies are used.</p>
        <div class="consent-actions">
          <a href="/legal/privacy.html" target="_blank">Privacy</a>
          <a href="/legal/cookies.html" target="_blank">Cookies</a>
          <button type="button" id="consent-accept-btn" class="consent-btn">Accept</button>
        </div>
      </div>
    `;

    document.body.appendChild(this.element);

    const btn = this.element.querySelector<HTMLButtonElement>('#consent-accept-btn');
    btn?.addEventListener('click', () => {
      localStorage.setItem(STORAGE_CONSENT_KEY, 'true');
      this.element?.remove();
      this.element = null;
    });
  }

  dispose(): void {
    this.element?.remove();
    this.element = null;
  }
}
