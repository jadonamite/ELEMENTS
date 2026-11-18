import {
  FIRST_SHRINE,
  LEGACY_SINDR_ORIGIN,
  SHRINES,
  litShrines,
  shrineAt,
} from '../../../shared/src/index.js';
import type { ShrineState } from '../shrine-state.js';
import type { WaypointDropTarget } from '../story/waypoint-marker.js';
export type MapRegion = 'IGNIS' | 'AQUES' | 'TERRA' | 'AURA' | 'CHROMARA';

export interface GlobalMapOptions {
  inTown: boolean;
  navigateToSindr: () => void;
  shrineState?: ShrineState | undefined;
  getPlayerPosition?: (() => { x: number; y: number; z: number }) | undefined;
  getDropTarget?: (() => WaypointDropTarget | null) | undefined;
  travel?: ((shrineId: string) => void | string | Promise<void | string>) | undefined;
  onNotice?: ((text: string) => void) | undefined;
  close?: (() => void) | undefined;
}

const REGIONS: ReadonlyArray<{
  id: MapRegion;
  name: string;
  subtitle: string;
  detail: string;
  places: readonly string[];
  ready: boolean;
  position: string;
}> = [
  { id: 'IGNIS', name: 'IGNIS', subtitle: 'The forge nation', detail: 'Sindr is the playable region: an 800-metre route from the Shrine of Embers through the town, out along Gorge Road and to the East Border Fort.', places: ['Shrine of Embers', 'Sindr', "Master's Hall", "Brandr's Keep", 'Gorge Road', 'Slag Barrens', 'East Border Fort'], ready: true, position: 'ignis' },
  { id: 'AQUES', name: 'AQUES', subtitle: 'The river nation', detail: 'The nation is part of the world design. Its regional map and travel route are not in this build yet.', places: ['River delta', 'Glacial fjord', 'Polar sanctuary'], ready: false, position: 'aques' },
  { id: 'TERRA', name: 'TERRA', subtitle: 'The ochre nation', detail: 'The nation is part of the world design. Its regional map and travel route are not in this build yet.', places: ['Canyon fortress', 'Quarry'], ready: false, position: 'terra' },
  { id: 'AURA', name: 'AURA', subtitle: 'The high nation', detail: 'The nation is part of the world design. Its regional map and travel route are not in this build yet.', places: ['High spire sanctuary'], ready: false, position: 'aura' },
  { id: 'CHROMARA', name: 'CHROMARA', subtitle: 'The neutral city', detail: 'The central city holds the main market, the Edict, the Lord’s treasury and the world boss. This location is not playable in the current build.', places: ['The main market', 'The Edict', 'The treasury', 'World boss'], ready: false, position: 'chromara' },
];

export function globalMapMarkup(inTown: boolean): string {
  const current = inTown ? 'IGNIS' : '';
  return `
    <section class="atlas-screen" aria-label="World map">
      <div class="atlas-map" role="group" aria-label="Schematic map of the four nations around Chromara">
        <div class="atlas-layer">
          <img class="atlas-art" decoding="async" data-src="/assets/ui/elements-world-atlas.png" alt="Illustrated world with volcanic, icy, mountainous and canyon regions around a central city" />
          <div class="atlas-wash" aria-hidden="true"></div>
          ${REGIONS.map(region => `
          <button type="button" class="atlas-region atlas-${region.position}${region.id === current ? ' is-current' : ''}" data-region="${region.id}" aria-pressed="${region.id === (current || 'CHROMARA')}" aria-label="${region.name}, ${region.subtitle}${region.ready ? ', available now' : ', not available yet'}">
            <span class="atlas-region-name">${region.name}</span>
            <span class="atlas-region-subtitle">${region.subtitle}</span>
            ${region.id === current ? '<span class="atlas-current">Current region</span>' : ''}
          </button>`).join('')}
        </div>
        <div class="atlas-zoom" role="group" aria-label="Map zoom controls">
          <button type="button" class="atlas-zoom-out" aria-label="Zoom out">−</button>
          <output class="atlas-zoom-level" aria-live="polite">100%</output>
          <button type="button" class="atlas-zoom-in" aria-label="Zoom in">+</button>
          <button type="button" class="atlas-zoom-reset">Reset</button>
        </div>
        <span class="atlas-note">Schematic world view, not to scale</span>
      </div>
      <aside class="atlas-detail" aria-live="polite">
        <div class="atlas-detail-top"><span class="atlas-kicker">World atlas</span><span class="atlas-status"></span></div>
        <h2 class="atlas-title"></h2>
        <p class="atlas-description"></p>
        <div class="atlas-drop-wrap" hidden></div>
        <div class="atlas-places-wrap"><h3>Known places</h3><ul class="atlas-places"></ul></div>
        <div class="atlas-shrines-wrap">
          <h3>Shrines</h3>
          <ul class="atlas-shrines"></ul>
          <div class="atlas-travel-wrap" hidden>
            <div class="atlas-travel-header">Fast Travel</div>
            <p class="atlas-travel-error" hidden></p>
            <ul class="atlas-travel-list"></ul>
          </div>
          <p class="atlas-travel-hint"></p>
        </div>
        <button type="button" class="home-btn primary atlas-enter" hidden>Enter Sindr</button>
        <button type="button" class="home-btn atlas-market" hidden>Read Chromara’s market board</button>
        <p class="atlas-travel-note">Travel between regions is not available yet.</p>
      </aside>
    </section>`;
}

export function bindGlobalMap(
  root: ParentNode,
  inTownOrOptions: boolean | GlobalMapOptions,
  legacyNavigate?: () => void,
): { refresh: () => void } {
  const options: GlobalMapOptions = typeof inTownOrOptions === 'boolean'
    ? { inTown: inTownOrOptions, navigateToSindr: legacyNavigate ?? (() => {}) }
    : inTownOrOptions;
  const inTown = options.inTown;
  const navigateToSindr = options.navigateToSindr;

  const buttons = [...root.querySelectorAll<HTMLButtonElement>('.atlas-region')];
  const title = root.querySelector<HTMLElement>('.atlas-title');
  const description = root.querySelector<HTMLElement>('.atlas-description');
  const status = root.querySelector<HTMLElement>('.atlas-status');
  const places = root.querySelector<HTMLUListElement>('.atlas-places');
  const dropWrap = root.querySelector<HTMLElement>('.atlas-drop-wrap');
  const shrinesWrap = root.querySelector<HTMLElement>('.atlas-shrines-wrap');
  const shrinesList = root.querySelector<HTMLUListElement>('.atlas-shrines');
  const travelWrap = root.querySelector<HTMLElement>('.atlas-travel-wrap');
  const travelHeader = root.querySelector<HTMLElement>('.atlas-travel-header');
  const travelError = root.querySelector<HTMLElement>('.atlas-travel-error');
  const travelList = root.querySelector<HTMLUListElement>('.atlas-travel-list');
  const travelHint = root.querySelector<HTMLElement>('.atlas-travel-hint');
  const enter = root.querySelector<HTMLButtonElement>('.atlas-enter');
  const travelNote = root.querySelector<HTMLElement>('.atlas-travel-note');
  const map = root.querySelector<HTMLElement>('.atlas-map');
  const layer = root.querySelector<HTMLElement>('.atlas-layer');
  const zoomLevel = root.querySelector<HTMLOutputElement>('.atlas-zoom-level');
  const zoomIn = root.querySelector<HTMLButtonElement>('.atlas-zoom-in');
  const zoomOut = root.querySelector<HTMLButtonElement>('.atlas-zoom-out');
  const zoomReset = root.querySelector<HTMLButtonElement>('.atlas-zoom-reset');
  let scale = 1;
  let panX = 0;
  let panY = 0;
  let currentSelected: MapRegion = inTown ? 'IGNIS' : 'CHROMARA';
  let drag: { pointerId: number; x: number; y: number; panX: number; panY: number } | undefined;
  const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
  const paint = (): void => {
    if (!map || !layer) return;
    const bounds = map.getBoundingClientRect();
    panX = clamp(panX, bounds.width * (1 - scale), 0);
    panY = clamp(panY, bounds.height * (1 - scale), 0);
    layer.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
    if (zoomLevel) zoomLevel.value = `${Math.round(scale * 100)}%`;
    map.classList.toggle('is-zoomed', scale > 1.01);
  };
  const syncVisualTransform = (): void => {
    if (!layer) return;
    const transform = getComputedStyle(layer).transform;
    const matrix = new DOMMatrixReadOnly(transform === 'none' ? undefined : transform);
    scale = matrix.a || 1;
    panX = matrix.e;
    panY = matrix.f;
    layer.style.transition = 'none';
    layer.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
    void layer.offsetWidth;
    layer.style.transition = '';
  };
  const zoomAt = (nextScale: number, x: number, y: number): void => {
    if (!map) return;
    syncVisualTransform();
    const rect = map.getBoundingClientRect();
    const next = clamp(nextScale, 1, 2.4);
    const worldX = (x - rect.left - panX) / scale;
    const worldY = (y - rect.top - panY) / scale;
    scale = next;
    panX = x - rect.left - worldX * scale;
    panY = y - rect.top - worldY * scale;
    paint();
  };
  const focusRegion = (button: HTMLButtonElement): void => {
    if (!map) return;
    syncVisualTransform();
    const rect = map.getBoundingClientRect();
    const target = button.getBoundingClientRect();
    const localX = ((target.left + target.width / 2) - rect.left - panX) / scale;
    const localY = ((target.top + target.height / 2) - rect.top - panY) / scale;
    scale = 1.75;
    panX = rect.width / 2 - localX * scale;
    panY = rect.height / 2 - localY * scale;
    paint();
  };
  const select = (id: MapRegion): void => {
    currentSelected = id;
    const region = REGIONS.find(item => item.id === id);
    if (!region || !title || !description || !status || !places || !enter || !travelNote) return;
    buttons.forEach(button => {
      const selected = button.dataset.region === id;
      button.setAttribute('aria-pressed', String(selected));
      button.classList.toggle('is-selected', selected);
    });
    const market = root.querySelector<HTMLButtonElement>('.atlas-market');
    if (market) market.hidden = id !== 'CHROMARA';
    title.textContent = region.name;
    description.textContent = region.detail;
    status.textContent = region.ready ? (inTown ? 'You are here' : 'Available now') : 'Not available yet';
    status.dataset.ready = String(region.ready);
    places.replaceChildren(...region.places.map(name => {
      const item = document.createElement('li');
      item.textContent = name;
      return item;
    }));

    if (dropWrap) {
      const drop = options.getDropTarget?.();
      if (drop && id === 'IGNIS') {
        const remainingSec = Math.max(0, Math.round((drop.expiresAt - Date.now()) / 1000));
        if (remainingSec > 0) {
          dropWrap.hidden = false;
          const pos = drop.getPosition();
          const playerPos = options.getPlayerPosition?.() ?? { x: 0, y: 0, z: 0 };
          const dist = Math.round(Math.hypot(pos.x - playerPos.x, pos.z - playerPos.z));
          const mins = Math.floor(remainingSec / 60);
          const secs = remainingSec % 60;
          const countdown = `${mins}:${secs.toString().padStart(2, '0')}`;
          dropWrap.innerHTML = `
            <div class="atlas-drop-card">
              <span class="atlas-drop-marker" aria-hidden="true"></span>
              <div class="atlas-drop-info">
                <span class="atlas-drop-title">${drop.title}</span>
                <span class="atlas-drop-meta">${dist}m away · ${countdown}</span>
              </div>
            </div>
          `;
        } else {
          dropWrap.hidden = true;
          dropWrap.innerHTML = '';
        }
      } else {
        dropWrap.hidden = true;
        dropWrap.innerHTML = '';
      }
    }

    if (shrinesWrap && shrinesList) {
      if (id === 'IGNIS') {
        shrinesWrap.hidden = false;
        const litSet = options.shrineState?.lit ?? new Set([FIRST_SHRINE]);
        shrinesList.replaceChildren(...SHRINES.map(s => {
          const isLit = options.shrineState ? options.shrineState.isLit(s.id) : (s.id === FIRST_SHRINE);
          const li = document.createElement('li');
          li.className = `atlas-shrine-item ${isLit ? 'is-lit' : 'is-dim'}`;
          const info = document.createElement('span');
          info.className = 'atlas-shrine-info';
          const marker = document.createElement('span');
          marker.className = `atlas-shrine-marker ${isLit ? 'is-lit' : 'is-dim'}`;
          marker.setAttribute('aria-hidden', 'true');
          const nameSpan = document.createElement('span');
          nameSpan.className = 'atlas-shrine-name';
          nameSpan.textContent = s.name;
          info.append(marker, nameSpan);
          const tag = document.createElement('span');
          tag.className = `atlas-shrine-tag ${isLit ? 'is-lit' : 'is-dim'}`;
          tag.textContent = isLit ? 'Lit' : 'Unlit';
          li.append(info, tag);
          return li;
        }));

        const playerPos = options.getPlayerPosition?.();
        const currentShrine = playerPos
          ? shrineAt(litSet, playerPos.x + LEGACY_SINDR_ORIGIN.x, playerPos.z + LEGACY_SINDR_ORIGIN.z)
          : null;

        if (travelWrap && travelHeader && travelError && travelList && travelHint) {
          if (currentShrine) {
            travelWrap.hidden = false;
            travelHeader.textContent = `Fast Travel from ${currentShrine.name}`;
            travelError.hidden = true;
            travelError.textContent = '';
            const otherLit = litShrines(litSet).filter(s => s.id !== currentShrine.id);
            if (otherLit.length === 0) {
              travelList.innerHTML = '<li class="atlas-travel-empty">Light other shrines across Ignis to travel between them.</li>';
            } else {
              travelList.replaceChildren(...otherLit.map(target => {
                const item = document.createElement('li');
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'atlas-travel-btn';
                btn.textContent = `Travel to ${target.name}`;
                btn.addEventListener('click', async () => {
                  travelError.hidden = true;
                  travelError.textContent = '';
                  if (options.travel) {
                    const res = await options.travel(target.id);
                    if (typeof res === 'string') {
                      travelError.textContent = res;
                      travelError.hidden = false;
                    }
                  }
                });
                item.appendChild(btn);
                return item;
              }));
            }
            travelHint.textContent = '';
          } else {
            travelWrap.hidden = true;
            travelHint.textContent = inTown ? 'Stand at a lit shrine to fast travel to other lit shrines.' : '';
          }
        }
      } else {
        shrinesWrap.hidden = true;
      }
    }

    enter.hidden = !region.ready || inTown;
    if (inTown && region.ready) enter.textContent = 'Current region';
    else enter.textContent = 'Enter Sindr';
    enter.disabled = inTown && region.ready;
    travelNote.hidden = region.ready;
  };
  buttons.forEach(button => button.addEventListener('click', () => {
    select(button.dataset.region as MapRegion);
    focusRegion(button);
  }));
  zoomIn?.addEventListener('click', () => {
    if (!map) return;
    const rect = map.getBoundingClientRect();
    zoomAt(scale + 0.25, rect.left + rect.width / 2, rect.top + rect.height / 2);
  });
  zoomOut?.addEventListener('click', () => {
    if (!map) return;
    const rect = map.getBoundingClientRect();
    zoomAt(scale - 0.25, rect.left + rect.width / 2, rect.top + rect.height / 2);
  });
  zoomReset?.addEventListener('click', () => { scale = 1; panX = 0; panY = 0; paint(); });
  map?.addEventListener('wheel', event => {
    event.preventDefault();
    zoomAt(scale + (event.deltaY < 0 ? 0.12 : -0.12), event.clientX, event.clientY);
  }, { passive: false });
  map?.addEventListener('pointerdown', event => {
    if (scale <= 1.01 || (event.target as HTMLElement).closest('button')) return;
    drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, panX, panY };
    map.setPointerCapture(event.pointerId);
  });
  map?.addEventListener('pointermove', event => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    panX = drag.panX + event.clientX - drag.x;
    panY = drag.panY + event.clientY - drag.y;
    paint();
  });
  const endDrag = (event: PointerEvent): void => { if (drag?.pointerId === event.pointerId) drag = undefined; };
  map?.addEventListener('pointerup', endDrag);
  map?.addEventListener('pointercancel', endDrag);
  enter?.addEventListener('click', navigateToSindr);
  root.querySelector('.atlas-market')?.addEventListener('click', () => {
    void import('../economy/market-board.js').then(m => m.openMarketBoard());
  });
  select(inTown ? 'IGNIS' : 'CHROMARA');
  return { refresh: () => select(currentSelected) };
}
