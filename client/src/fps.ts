/**
 * Minimal frame-rate counter displayed in the top-left corner.
 * Updates once per second to avoid jitter.
 */

export class FpsCounter {
  private readonly el: HTMLDivElement;
  private frames = 0;
  private lastTime = performance.now();

  constructor() {
    this.el = document.createElement('div');
    Object.assign(this.el.style, {
      position: 'fixed',
      top: '8px',
      left: '8px',
      padding: '4px 8px',
      fontFamily: 'var(--font-family-mono, monospace)',
      fontSize: '13px',
      lineHeight: '1',
      color: '#e0e0e0',
      background: 'rgba(0, 0, 0, 0.55)',
      borderRadius: '4px',
      zIndex: '1000',
      pointerEvents: 'none',
      userSelect: 'none',
    });
    this.el.textContent = '-- fps';
    document.body.appendChild(this.el);
  }

  /** Call once per frame. */
  tick(): void {
    this.frames++;
    const now = performance.now();
    const elapsed = now - this.lastTime;
    if (elapsed >= 1000) {
      const fps = Math.round((this.frames * 1000) / elapsed);
      this.el.textContent = `${fps} fps`;
      this.frames = 0;
      this.lastTime = now;
    }
  }

  dispose(): void {
    this.el.remove();
  }
}
