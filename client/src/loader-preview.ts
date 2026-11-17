import './ui/tokens.css';
import './ui/loader.css';
import { Loader } from './ui/loader.js';
import { LOADER_PICTURES, loaderPictureDetails } from './ui/loader-pictures.js';

let activePlateIndex = 0;
let activeProgress = 0.15;
let activeDestination: 'town' | 'arena' = 'town';
let activeLoader: Loader | null = null;
let animationTimer: ReturnType<typeof setInterval> | null = null;

const stages = [
  { at: 0.05, name: 'Reading the world manifest' },
  { at: 0.20, name: "Raising Sindr's streets" },
  { at: 0.45, name: 'Forging the hero' },
  { at: 0.75, name: 'Awakening the townspeople' },
  { at: 0.95, name: 'Calibrating the light' },
  { at: 1.00, name: 'Ready' },
];

function stageForProgress(p: number): string {
  for (let i = stages.length - 1; i >= 0; i--) {
    if (p >= stages[i]!.at) return stages[i]!.name;
  }
  return 'Reading the world manifest';
}

function mountLoader(): void {
  if (activeLoader) {
    activeLoader.dispose();
    activeLoader = null;
  }

  const plateId = LOADER_PICTURES[activePlateIndex]!;
  const picturePath = `/assets/ui/loader/pictures/${plateId}.webp`;

  activeLoader = new Loader({
    destination: activeDestination,
    picture: picturePath,
    onEnter: () => {
      console.log('Loader onEnter triggered');
    },
  });

  activeLoader.setProgress(activeProgress, stageForProgress(activeProgress));
}

function setupControls(): void {
  const bar = document.createElement('aside');
  bar.id = 'loader-preview-bar';
  bar.setAttribute('aria-label', 'Loader preview controls');
  bar.style.cssText = `
    position: fixed;
    bottom: 16px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 9999;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
    padding: 8px 16px;
    background: #171816;
    color: #efede7;
    border: 1px solid #4a4b47;
    border-radius: 6px;
    font: 12px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.45);
    user-select: none;
  `;

  // Plate Select
  const selectLabel = document.createElement('label');
  selectLabel.textContent = 'Plate: ';
  selectLabel.style.display = 'flex';
  selectLabel.style.alignItems = 'center';
  selectLabel.style.gap = '4px';

  const select = document.createElement('select');
  select.style.cssText = 'background: #2a2b27; color: #efede7; border: 1px solid #60615d; border-radius: 4px; padding: 2px 6px; font-size: 12px;';
  LOADER_PICTURES.forEach((id, idx) => {
    const details = loaderPictureDetails(`/assets/ui/loader/pictures/${id}.webp`);
    const opt = document.createElement('option');
    opt.value = String(idx);
    opt.textContent = `${details.number}: ${details.caption} (${details.element})`;
    select.appendChild(opt);
  });
  select.value = String(activePlateIndex);
  select.addEventListener('change', () => {
    activePlateIndex = Number(select.value);
    mountLoader();
  });
  selectLabel.appendChild(select);
  bar.appendChild(selectLabel);

  // Destination Toggle
  const destBtn = document.createElement('button');
  destBtn.type = 'button';
  destBtn.textContent = 'Dest: Town';
  destBtn.style.cssText = 'background: #2a2b27; color: #efede7; border: 1px solid #60615d; border-radius: 4px; padding: 3px 8px; cursor: pointer;';
  destBtn.addEventListener('click', () => {
    activeDestination = activeDestination === 'town' ? 'arena' : 'town';
    destBtn.textContent = `Dest: ${activeDestination === 'town' ? 'Town' : 'Arena'}`;
    mountLoader();
  });
  bar.appendChild(destBtn);

  // Progress Slider
  const sliderLabel = document.createElement('label');
  sliderLabel.style.display = 'flex';
  sliderLabel.style.alignItems = 'center';
  sliderLabel.style.gap = '6px';

  const progressVal = document.createElement('span');
  progressVal.textContent = `${Math.round(activeProgress * 100)}%`;
  progressVal.style.minWidth = '36px';

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '0';
  slider.max = '100';
  slider.value = String(Math.round(activeProgress * 100));
  slider.style.cursor = 'pointer';
  slider.addEventListener('input', () => {
    if (animationTimer) {
      clearInterval(animationTimer);
      animationTimer = null;
      playBtn.textContent = 'Simulate Load';
    }
    activeProgress = Number(slider.value) / 100;
    progressVal.textContent = `${slider.value}%`;
    activeLoader?.setProgress(activeProgress, stageForProgress(activeProgress));
  });
  sliderLabel.appendChild(document.createTextNode('Progress: '));
  sliderLabel.appendChild(slider);
  sliderLabel.appendChild(progressVal);
  bar.appendChild(sliderLabel);

  // Simulate Load Animation Button
  const playBtn = document.createElement('button');
  playBtn.type = 'button';
  playBtn.textContent = 'Simulate Load';
  playBtn.style.cssText = 'background: #393a35; color: #efede7; border: 1px solid #60615d; border-radius: 4px; padding: 3px 8px; cursor: pointer; font-weight: 500;';
  playBtn.addEventListener('click', () => {
    if (animationTimer) {
      clearInterval(animationTimer);
      animationTimer = null;
      playBtn.textContent = 'Simulate Load';
      return;
    }
    activeProgress = 0;
    slider.value = '0';
    progressVal.textContent = '0%';
    activeLoader?.setProgress(0, stageForProgress(0));
    playBtn.textContent = 'Pause';

    animationTimer = setInterval(() => {
      if (activeProgress >= 1) {
        clearInterval(animationTimer!);
        animationTimer = null;
        playBtn.textContent = 'Simulate Load';
        return;
      }
      activeProgress = Math.min(1, activeProgress + 0.01);
      slider.value = String(Math.round(activeProgress * 100));
      progressVal.textContent = `${slider.value}%`;
      activeLoader?.setProgress(activeProgress, stageForProgress(activeProgress));
    }, 120);
  });
  bar.appendChild(playBtn);

  // Hide/Show Controls Toggle
  const hideBtn = document.createElement('button');
  hideBtn.type = 'button';
  hideBtn.textContent = 'Hide Controls (Press H)';
  hideBtn.style.cssText = 'background: transparent; color: #b9bab4; border: 1px solid #4a4b47; border-radius: 4px; padding: 3px 8px; cursor: pointer;';
  hideBtn.addEventListener('click', () => {
    bar.style.display = 'none';
  });
  bar.appendChild(hideBtn);

  window.addEventListener('keydown', (e) => {
    if (e.key === 'h' || e.key === 'H') {
      bar.style.display = bar.style.display === 'none' ? 'flex' : 'none';
    }
  });

  document.body.appendChild(bar);
}

mountLoader();
setupControls();
