import { mergeControlProgress, needsControlLesson, normalizeControlProgress, LEARNING_LIMIT,
  type ControlAction, type ControlProgress } from '../../../shared/src/controls/index.js';
import { getServerUrl, getStoredAccountId, getStoredAuthToken, hasGameServer } from '../auth/server-api.js';

/** Bounded teaching memory, cached per character and merged with the authenticated server. */
export class ControlLearning {
  progress: ControlProgress = {};
  ready = false;
  version = 0;
  syncError = false;
  private key = '';
  private identity = '';
  private pending = false;
  private saving = false;
  private disposed = false;
  private timer = 0;
  private nextIdentityCheck = 0;
  private revision = 0;
  private events = new AbortController();
  constructor(private readonly onTier: (tier: number) => void = () => {}) {
    document.addEventListener('visibilitychange', () => { if (document.hidden) void this.flush(); }, { signal: this.events.signal });
    window.addEventListener('online', () => { void this.load(); }, { signal: this.events.signal });
    this.checkIdentity();
  }
  checkIdentity(now = performance.now()): void {
    if (now < this.nextIdentityCheck) return;
    this.nextIdentityCheck = now + 1000;
    const account = getStoredAccountId() ?? 'guest', token = getStoredAuthToken() ?? '';
    const identity = `${account}:${token}`;
    if (identity === this.identity) return;
    this.identity = identity; this.revision++; this.ready = false; this.syncError = false;
    this.key = `elements_controls_v1:${account}`; this.pending = false;
    try { this.progress = normalizeControlProgress(JSON.parse(localStorage.getItem(this.key) ?? '{}')); }
    catch { this.progress = {}; }
    this.version++;
    void this.load();
  }
  private async load(): Promise<void> {
    const revision = this.revision;
    if (!hasGameServer() || !getStoredAuthToken()) { this.ready = true; return; }
    try {
      const response = await fetch(`${getServerUrl()}/api/character/controls`, {
        headers: { Authorization: `Bearer ${getStoredAuthToken()}` }, signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error('Control learning could not load');
      const data = await response.json() as { progress: unknown; tier?: number };
      if (revision !== this.revision || this.disposed) return;
      this.version++;
      this.progress = mergeControlProgress(this.progress, normalizeControlProgress(data.progress));
      if (typeof data.tier === 'number' && Number.isInteger(data.tier) && data.tier >= 0 && data.tier <= 7) this.onTier(data.tier);
      this.syncError = false; this.cache(); this.pending = true; this.schedule();
    } catch {
      if (revision === this.revision) this.syncError = true;
    } finally { if (revision === this.revision) this.ready = true; }
  }
  needs(action: ControlAction): boolean { return this.ready && needsControlLesson(this.progress, action); }
  record(action: ControlAction, kind: 'uses' | 'shown' = 'uses'): void {
    const old = this.progress[action] ?? { uses: 0, shown: 0 };
    if (old[kind] >= LEARNING_LIMIT) return;
    this.version++;
    this.progress[action] = { ...old, [kind]: old[kind] + 1 };
    this.cache(); this.pending = true; this.schedule();
  }
  private cache(): void {
    try { localStorage.setItem(this.key, JSON.stringify(this.progress)); } catch { /* Server remains the durable store. */ }
  }
  private schedule(delay = 2000): void {
    if (!this.timer && !this.disposed) this.timer = window.setTimeout(() => { this.timer = 0; void this.flush(); }, delay);
  }
  async flush(): Promise<void> {
    if (this.saving || !this.pending || !getStoredAuthToken() || !hasGameServer()) return;
    const revision = this.revision;
    this.saving = true; this.pending = false;
    try {
      const response = await fetch(`${getServerUrl()}/api/character/controls`, {
        method: 'POST', keepalive: true, signal: AbortSignal.timeout(8000),
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getStoredAuthToken()}` },
        body: JSON.stringify({ progress: this.progress }),
      });
      if (!response.ok) throw new Error('Control learning could not save');
      const data = await response.json() as { progress: unknown };
      if (revision === this.revision && !this.disposed) {
        this.version++;
        this.progress = mergeControlProgress(this.progress, normalizeControlProgress(data.progress));
        this.syncError = false; this.cache();
      }
    } catch { if (revision === this.revision) { this.pending = true; this.syncError = true; } }
    finally { this.saving = false; if (this.pending) this.schedule(15000); }
  }
  dispose(): void {
    void this.flush(); this.disposed = true; this.events.abort(); window.clearTimeout(this.timer);
  }
}
