/**
 * UI controller for character creation.
 * Provides accessible, typographic preset selection with 44px minimum targets,
 * keyboard navigation, real-time 3D viewport updates, and randomisation.
 */

import { CreatorScene } from './creator-scene.js';
import {
  BODY_PRESET_OPTIONS,
  type CharacterConfig,
  getDefaultCharacterConfig,
  getStoredCharacter,
  HAIR_COLOR_PRESETS,
  HAIR_STYLE_OPTIONS,
  rollRandomCharacter,
  saveStoredCharacter,
  SKIN_TONE_PRESETS,
} from './creator-types.js';

export class CreatorView {
  private readonly container: HTMLElement;
  private readonly onComplete: (config: CharacterConfig) => void;
  private scene: CreatorScene | null = null;
  private currentConfig: CharacterConfig;

  constructor(
    parentContainer: HTMLElement,
    onComplete: (config: CharacterConfig) => void
  ) {
    this.container = parentContainer;
    this.onComplete = onComplete;
    this.currentConfig = getStoredCharacter() ?? getDefaultCharacterConfig('female');

    this.render();
  }

  private render(): void {
    this.container.innerHTML = `
      <div class="creator-modal">
        <div class="creator-layout">
          <!-- 3D Character Viewport -->
          <div class="creator-viewport-card">
            <div class="viewport-header">
              <span class="creator-badge">Identity Awakening</span>
              <h2 class="creator-title">Shape Your Hero</h2>
            </div>
            <div id="creator-3d-container" class="creator-canvas-container" tabindex="0" aria-label="Character 3D Viewport. Drag to rotate."></div>
            <div class="viewport-hint">Drag or swipe to rotate character</div>
          </div>

          <!-- Customization Controls Panel -->
          <div class="creator-panel" role="region" aria-label="Character Customization Options">
            <!-- Sex / Anatomy -->
            <div class="control-section">
              <label class="section-label">Sex & Form</label>
              <div class="pill-group" role="radiogroup" aria-label="Sex selection">
                <button type="button" class="creator-pill ${this.currentConfig.sex === 'female' ? 'active' : ''}" data-action="set-sex" data-value="female" role="radio" aria-checked="${this.currentConfig.sex === 'female'}">Female</button>
                <button type="button" class="creator-pill ${this.currentConfig.sex === 'male' ? 'active' : ''}" data-action="set-sex" data-value="male" role="radio" aria-checked="${this.currentConfig.sex === 'male'}">Male</button>
              </div>
            </div>

            <!-- Heritage / Race Note -->
            <div class="control-section">
              <div class="heritage-note">
                <span class="heritage-label">One fighter, any build</span>
                <p class="heritage-desc">Every body fights with the same moves, whatever its build.</p>
              </div>
            </div>

            <!-- Body Build Presets -->
            <div class="control-section">
              <label class="section-label">Body Build</label>
              <div class="pill-group grid-2x2" role="radiogroup" aria-label="Body build preset">
                ${BODY_PRESET_OPTIONS.map(b => `
                  <button type="button" class="creator-pill ${this.currentConfig.bodyPreset === b.id ? 'active' : ''}" data-action="set-body" data-value="${b.id}" role="radio" aria-checked="${this.currentConfig.bodyPreset === b.id}" title="${b.description}">
                    ${b.name}
                  </button>
                `).join('')}
              </div>
            </div>

            <!-- Skin Tone Presets -->
            <div class="control-section">
              <div class="section-header-row">
                <label class="section-label">Skin Tone</label>
                <span id="active-skin-name" class="selection-name">${SKIN_TONE_PRESETS.find(p => p.id === this.currentConfig.skinToneId)?.name ?? ''}</span>
              </div>
              <div class="swatch-grid skin-grid" role="radiogroup" aria-label="Skin tone selection">
                ${SKIN_TONE_PRESETS.map(s => `
                  <button type="button" class="color-swatch ${this.currentConfig.skinToneId === s.id ? 'active' : ''}" data-action="set-skin" data-value="${s.id}" style="background-color: ${s.hex};" role="radio" aria-checked="${this.currentConfig.skinToneId === s.id}" aria-label="${s.name}"></button>
                `).join('')}
              </div>
            </div>

            <!-- Hairstyle Presets -->
            <div class="control-section">
              <label class="section-label">Hairstyle</label>
              <div id="hair-style-list" class="hair-style-list" role="radiogroup" aria-label="Hairstyle selection">
                ${this.renderHairStyleButtons()}
              </div>
            </div>

            <!-- Hair Color Presets -->
            <div class="control-section">
              <div class="section-header-row">
                <label class="section-label">Hair Color</label>
                <span id="active-hair-color-name" class="selection-name">${HAIR_COLOR_PRESETS.find(c => c.id === this.currentConfig.hairColorId)?.name ?? ''}</span>
              </div>
              <div class="swatch-grid hair-color-grid" role="radiogroup" aria-label="Hair color selection">
                ${HAIR_COLOR_PRESETS.map(c => `
                  <button type="button" class="color-swatch ${this.currentConfig.hairColorId === c.id ? 'active' : ''}" data-action="set-hair-color" data-value="${c.id}" style="background-color: ${c.hex};" role="radio" aria-checked="${this.currentConfig.hairColorId === c.id}" aria-label="${c.name}"></button>
                `).join('')}
              </div>
            </div>

            <!-- Actions Row -->
            <div class="creator-actions">
              <button type="button" id="randomize-character-btn" class="opening-button secondary action-btn">
                Randomise
              </button>
              <button type="button" id="confirm-character-btn" class="opening-button primary action-btn">
                Confirm Identity
              </button>
            </div>
          </div>
        </div>
      </div>
    `;

    const viewportContainer = this.container.querySelector<HTMLElement>('#creator-3d-container')!;
    this.scene = new CreatorScene(viewportContainer, this.currentConfig);

    this.bindEvents();
  }

  private renderHairStyleButtons(): string {
    return HAIR_STYLE_OPTIONS
      .filter(h => h.allowedSex.includes(this.currentConfig.sex))
      .map(h => `
        <button type="button" class="creator-pill style-pill ${this.currentConfig.hairStyleId === h.id ? 'active' : ''}" data-action="set-hair-style" data-value="${h.id}" role="radio" aria-checked="${this.currentConfig.hairStyleId === h.id}">
          ${h.name}
        </button>
      `).join('');
  }

  private updateHairStyleListDOM(): void {
    const listEl = this.container.querySelector<HTMLElement>('#hair-style-list');
    if (listEl) {
      listEl.innerHTML = this.renderHairStyleButtons();
    }
  }

  private bindEvents(): void {
    // Event delegation for all control clicks
    this.container.addEventListener('click', (e) => {
      const target = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');
      if (!target) return;

      const action = target.getAttribute('data-action');
      const value = target.getAttribute('data-value');
      if (!action || !value) return;

      switch (action) {
        case 'set-sex': {
          if (value === 'male' || value === 'female') {
            this.currentConfig.sex = value;
            // Adjust hairstyle if current selection is not available for new sex
            const allowed = HAIR_STYLE_OPTIONS.filter(h => h.allowedSex.includes(this.currentConfig.sex)).map(h => h.id);
            if (!allowed.includes(this.currentConfig.hairStyleId)) {
              this.currentConfig.hairStyleId = this.currentConfig.sex === 'female' ? 'buns' : 'simple_parted';
            }
            this.updateHairStyleListDOM();
            this.updateHighlights();
            this.scene?.updateConfig(this.currentConfig);
          }
          break;
        }

        case 'set-body': {
          this.currentConfig.bodyPreset = value as CharacterConfig['bodyPreset'];
          this.updateHighlights();
          this.scene?.updateConfig(this.currentConfig);
          break;
        }

        case 'set-skin': {
          this.currentConfig.skinToneId = value;
          this.updateHighlights();
          this.scene?.updateConfig(this.currentConfig);
          break;
        }

        case 'set-hair-style': {
          this.currentConfig.hairStyleId = value as CharacterConfig['hairStyleId'];
          this.updateHighlights();
          this.scene?.updateConfig(this.currentConfig);
          break;
        }

        case 'set-hair-color': {
          this.currentConfig.hairColorId = value;
          this.updateHighlights();
          this.scene?.updateConfig(this.currentConfig);
          break;
        }
      }
    });

    // Randomise button
    const randBtn = this.container.querySelector<HTMLButtonElement>('#randomize-character-btn')!;
    randBtn.addEventListener('click', () => {
      this.currentConfig = rollRandomCharacter();
      this.updateHairStyleListDOM();
      this.updateHighlights();
      this.scene?.updateConfig(this.currentConfig);
    });

    // Confirm button
    const confirmBtn = this.container.querySelector<HTMLButtonElement>('#confirm-character-btn')!;
    confirmBtn.addEventListener('click', () => {
      saveStoredCharacter(this.currentConfig);
      this.dispose();
      this.onComplete(this.currentConfig);
    });
  }

  private updateHighlights(): void {
    // Update active skin name label
    const skinNameEl = this.container.querySelector<HTMLElement>('#active-skin-name');
    if (skinNameEl) {
      const preset = SKIN_TONE_PRESETS.find(p => p.id === this.currentConfig.skinToneId);
      skinNameEl.textContent = preset ? preset.name : '';
    }

    // Update active hair color name label
    const hairColorEl = this.container.querySelector<HTMLElement>('#active-hair-color-name');
    if (hairColorEl) {
      const preset = HAIR_COLOR_PRESETS.find(c => c.id === this.currentConfig.hairColorId);
      hairColorEl.textContent = preset ? preset.name : '';
    }

    // Update button states
    this.container.querySelectorAll<HTMLButtonElement>('button[data-action]').forEach(btn => {
      const action = btn.getAttribute('data-action');
      const val = btn.getAttribute('data-value');
      let isActive = false;

      if (action === 'set-sex') isActive = this.currentConfig.sex === val;
      if (action === 'set-body') isActive = this.currentConfig.bodyPreset === val;
      if (action === 'set-skin') isActive = this.currentConfig.skinToneId === val;
      if (action === 'set-hair-style') isActive = this.currentConfig.hairStyleId === val;
      if (action === 'set-hair-color') isActive = this.currentConfig.hairColorId === val;

      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-checked', isActive ? 'true' : 'false');
    });
  }

  private rebuildUI(): void {
    this.dispose();
    this.render();
  }

  dispose(): void {
    if (this.scene) {
      this.scene.dispose();
      this.scene = null;
    }
  }
}
