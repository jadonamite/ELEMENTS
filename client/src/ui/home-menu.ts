import './home-menu.css';

export interface HomeMenuOptions {
  inTown: boolean;
  currentElement: string;
  isDim: boolean;
  onOpenPicker: () => void;
  onOpenCreator: () => void;
}

export class HomeMenu {
  private readonly hudButton: HTMLButtonElement;
  private readonly overlay: HTMLDivElement;
  private readonly lightbox: HTMLDivElement;
  private readonly lightboxImg: HTMLImageElement;
  private readonly lightboxCaption: HTMLParagraphElement;
  private isOpen = false;

  constructor(private readonly options: HomeMenuOptions) {
    // 1. Fixed HUD Button (Top Left)
    this.hudButton = document.createElement('button');
    this.hudButton.id = 'home-hud-button';
    this.hudButton.type = 'button';
    this.hudButton.setAttribute('aria-label', 'Open navigation and reference menu');
    this.hudButton.innerHTML = '<span>Menu</span>';
    document.body.appendChild(this.hudButton);

    // 2. Main Overlay
    this.overlay = document.createElement('div');
    this.overlay.className = 'home-menu-overlay';
    this.overlay.setAttribute('role', 'dialog');
    this.overlay.setAttribute('aria-modal', 'true');
    this.overlay.setAttribute('aria-label', 'Game menu and references');

    const locationName = options.inTown ? 'Sindr • IGNIS Nation' : 'Combat Arena';

    this.overlay.innerHTML = `
      <div class="home-menu-dialog">
        <div class="home-menu-header">
          <div class="home-menu-title-group">
            <h2 class="home-menu-title">ELEMENTS</h2>
            <span class="home-menu-badge">${locationName}</span>
          </div>
          <button type="button" class="home-menu-close" aria-label="Close menu">X</button>
        </div>

        <nav class="home-menu-nav" aria-label="Menu tabs">
          <button type="button" class="home-nav-tab active" data-tab="modes">World & Modes</button>
          <button type="button" class="home-nav-tab" data-tab="fighter">Fighter & Character</button>
          <button type="button" class="home-nav-tab" data-tab="environment">Environment & Time</button>
        </nav>

        <div class="home-menu-body">
          <!-- Tab 1: World & Modes -->
          <div class="home-tab-pane active" id="pane-modes">
            <div class="home-grid-2">
              <div class="home-card">
                <div class="home-card-header">
                  <h3>Sindr — Open Nation</h3>
                  <p>800m traversable IGNIS nation from the Shrine of Embers through the forge town, Master's Hall, Brandr's Keep crag, Gorge Road, Slag Barrens, and East Border Fort.</p>
                </div>
                <div class="home-card-actions">
                  <button type="button" class="home-btn primary" id="btn-goto-town" ${options.inTown ? 'disabled' : ''}>
                    ${options.inTown ? 'Currently in Sindr' : 'Travel to Sindr'}
                  </button>
                </div>
              </div>

              <div class="home-card">
                <div class="home-card-header">
                  <h3>Combat Arena</h3>
                  <p>Dedicated combat arena testing eight rounds of villains, armed fighters, and benders with full elemental movesets and lock-on targeting.</p>
                </div>
                <div class="home-card-actions">
                  <button type="button" class="home-btn" id="btn-goto-arena" ${!options.inTown ? 'disabled' : ''}>
                    ${!options.inTown ? 'Currently in Arena' : 'Enter Arena'}
                  </button>
                </div>
              </div>

              <div class="home-card">
                <div class="home-card-header">
                  <h3>Sindr Market Brawl</h3>
                  <p>Preset fight encounter in the town square market among the stalls and fountain.</p>
                </div>
                <div class="home-card-actions">
                  <button type="button" class="home-btn" id="btn-goto-brawl">Start Market Brawl</button>
                </div>
              </div>

              <div class="home-card">
                <div class="home-card-header">
                  <h3>Fast Nation Walk</h3>
                  <p>Skips introduction screens and launches directly at the Shrine of Embers facing east toward Sindr.</p>
                </div>
                <div class="home-card-actions">
                  <button type="button" class="home-btn" id="btn-goto-fast">Quick Launch</button>
                </div>
              </div>
            </div>
          </div>


          <!-- Tab 3: Fighter & Character -->
          <div class="home-tab-pane" id="pane-fighter">
            <div class="home-grid-2">
              <div class="home-card">
                <div class="home-card-header">
                  <h3>Fighter Selection</h3>
                  <p>Choose between the four elemental Shapers (IGNIS, AQUES, TERRA, AURA) or the non-bending Hush. Inspect moves, weapons, and combat properties.</p>
                </div>
                <div class="home-card-actions">
                  <button type="button" class="home-btn primary" id="btn-open-picker">Change Fighter / Element</button>
                </div>
              </div>

              <div class="home-card">
                <div class="home-card-header">
                  <h3>Character Appearance</h3>
                  <p>Open the in-game character creator to adjust body presets, hair styles, and skin tones.</p>
                </div>
                <div class="home-card-actions">
                  <button type="button" class="home-btn" id="btn-open-creator">Customize Character</button>
                </div>
              </div>
            </div>
          </div>

          <!-- Tab 4: Environment & Time -->
          <div class="home-tab-pane" id="pane-environment">
            <div class="home-grid-2">
              <div class="home-card">
                <div class="home-card-header">
                  <h3>Time of Day Presets</h3>
                  <p>Preview the lighting, sky shaders, and light sources across the full day and night cycle.</p>
                </div>
                <div class="home-card-actions" style="flex-wrap: wrap;">
                  <button type="button" class="home-btn" id="btn-tod-day">Day</button>
                  <button type="button" class="home-btn" id="btn-tod-dusk">Dusk</button>
                  <button type="button" class="home-btn" id="btn-tod-night">Night</button>
                  <button type="button" class="home-btn" id="btn-tod-dawn">Dawn</button>
                </div>
              </div>

              <div class="home-card">
                <div class="home-card-header">
                  <h3>Graphics Quality</h3>
                  <p>Switch between full high-fidelity PBR rendering and low-performance profile for maximum framerate.</p>
                </div>
                <div class="home-card-actions">
                  <button type="button" class="home-btn" id="btn-quality-high">High Quality</button>
                  <button type="button" class="home-btn" id="btn-quality-low">Low Quality</button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="home-menu-footer">
          <span class="home-menu-hint">Press ESC to toggle this menu at any time.</span>
          <button type="button" class="home-btn primary" id="btn-resume">Resume Game</button>
        </div>
      </div>
    `;

    document.body.appendChild(this.overlay);

    // 3. Lightbox for Reference Inspection
    this.lightbox = document.createElement('div');
    this.lightbox.className = 'ref-lightbox';
    this.lightbox.innerHTML = `
      <button type="button" class="ref-lightbox-close" aria-label="Close image">Close</button>
      <img src="" alt="Enlarged Reference" />
      <p class="ref-lightbox-caption"></p>
    `;
    document.body.appendChild(this.lightbox);
    this.lightboxImg = this.lightbox.querySelector('img')!;
    this.lightboxCaption = this.lightbox.querySelector('.ref-lightbox-caption')!;

    this.bindEvents();
  }

  private bindEvents(): void {
    // Open/Close
    this.hudButton.addEventListener('click', () => {
      if (document.pointerLockElement) document.exitPointerLock();
      this.open();
    });

    this.overlay.querySelector('.home-menu-close')!.addEventListener('click', () => this.close());
    this.overlay.querySelector('#btn-resume')!.addEventListener('click', () => this.close());

    // Tabs
    const tabs = this.overlay.querySelectorAll<HTMLButtonElement>('.home-nav-tab');
    const panes = this.overlay.querySelectorAll<HTMLDivElement>('.home-tab-pane');
    for (const tab of tabs) {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        panes.forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        const target = tab.dataset.tab;
        const pane = this.overlay.querySelector(`#pane-${target}`);
        pane?.classList.add('active');
      });
    }

    // Modes
    this.overlay.querySelector('#btn-goto-town')?.addEventListener('click', () => {
      this.navigate({ town: '' });
    });
    this.overlay.querySelector('#btn-goto-arena')?.addEventListener('click', () => {
      this.navigate({}, ['town', 'brawl']);
    });
    this.overlay.querySelector('#btn-goto-brawl')?.addEventListener('click', () => {
      this.navigate({ town: '', brawl: 'market' });
    });
    this.overlay.querySelector('#btn-goto-fast')?.addEventListener('click', () => {
      this.navigate({ town: '', skipIntro: '' });
    });

    // Fighter & Appearance
    this.overlay.querySelector('#btn-open-picker')?.addEventListener('click', () => {
      this.close();
      this.options.onOpenPicker();
    });
    this.overlay.querySelector('#btn-open-creator')?.addEventListener('click', () => {
      this.close();
      this.options.onOpenCreator();
    });

    // Environment & Time
    this.overlay.querySelector('#btn-tod-day')?.addEventListener('click', () => this.navigate({ night: '0' }));
    this.overlay.querySelector('#btn-tod-dusk')?.addEventListener('click', () => this.navigate({ night: '0.5' }));
    this.overlay.querySelector('#btn-tod-night')?.addEventListener('click', () => this.navigate({ night: '1' }));
    this.overlay.querySelector('#btn-tod-dawn')?.addEventListener('click', () => this.navigate({ night: '0.2' }));

    this.overlay.querySelector('#btn-quality-high')?.addEventListener('click', () => this.navigate({}, ['fxQuality']));
    this.overlay.querySelector('#btn-quality-low')?.addEventListener('click', () => this.navigate({ fxQuality: 'low' }));

    // Reference Image Lightbox
    for (const img of this.overlay.querySelectorAll<HTMLImageElement>('.ref-item img')) {
      img.addEventListener('click', () => {
        const fullSrc = img.dataset.full ?? img.src;
        const caption = img.dataset.caption ?? img.alt;
        this.lightboxImg.src = fullSrc;
        this.lightboxCaption.textContent = caption;
        this.lightbox.classList.add('open');
      });
    }

    this.lightbox.querySelector('.ref-lightbox-close')!.addEventListener('click', () => {
      this.lightbox.classList.remove('open');
    });
    this.lightbox.addEventListener('click', (e) => {
      if (e.target === this.lightbox) this.lightbox.classList.remove('open');
    });

    // Global Escape Key Handler
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (this.lightbox.classList.contains('open')) {
          e.stopPropagation();
          this.lightbox.classList.remove('open');
          return;
        }
        if (this.isOpen) {
          e.stopPropagation();
          this.close();
          return;
        }
        // If not in pointer lock and not already selecting, pressing Esc opens menu
        if (!document.pointerLockElement && !document.body.classList.contains('selecting')) {
          this.open();
        }
      }
    });
  }

  open(): void {
    this.isOpen = true;
    this.overlay.classList.add('open');
    document.body.classList.add('home-open');
    (this.overlay.querySelector('.home-menu-close') as HTMLElement)?.focus();
  }

  close(): void {
    this.isOpen = false;
    this.overlay.classList.remove('open');
    this.lightbox.classList.remove('open');
    document.body.classList.remove('home-open');
  }

  private navigate(setParams: Record<string, string>, removeParams: string[] = []): void {
    const url = new URL(window.location.href);
    for (const param of removeParams) url.searchParams.delete(param);
    for (const [key, value] of Object.entries(setParams)) {
      if (value === '') url.searchParams.set(key, '');
      else url.searchParams.set(key, value);
    }
    window.location.href = url.toString();
  }

  dispose(): void {
    this.hudButton.remove();
    this.overlay.remove();
    this.lightbox.remove();
    document.body.classList.remove('home-open');
  }
}
