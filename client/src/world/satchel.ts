export interface SatchelItem {
  id: string;
  name: string;
  count: number;
}

export interface DroppedSatchel {
  x: number;
  z: number;
  items: SatchelItem[];
}

const STORAGE_KEY = 'elements_player_satchel';
const GRAVE_KEY = 'elements_dropped_satchel';

export class Satchel {
  items: SatchelItem[] = [];
  dropped: DroppedSatchel | null = null;

  constructor() {
    this.load();
  }

  load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      this.items = raw ? JSON.parse(raw) : [
        { id: 'ash_crystal', name: 'Ash Crystal', count: 3 },
        { id: 'ember_fang', name: 'Ember Fang', count: 1 },
      ];
      const graveRaw = localStorage.getItem(GRAVE_KEY);
      this.dropped = graveRaw ? JSON.parse(graveRaw) : null;
    } catch {
      this.items = [];
      this.dropped = null;
    }
  }

  save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.items));
      if (this.dropped) {
        localStorage.setItem(GRAVE_KEY, JSON.stringify(this.dropped));
      } else {
        localStorage.removeItem(GRAVE_KEY);
      }
    } catch {}
  }

  addItem(id: string, name: string, count = 1): void {
    const existing = this.items.find(i => i.id === id);
    if (existing) {
      existing.count += count;
    } else {
      this.items.push({ id, name, count });
    }
    this.save();
  }

  /** Drops carried contents at death position and empties satchel. */
  dropOnDeath(x: number, z: number): void {
    if (this.items.length > 0) {
      this.dropped = { x, z, items: [...this.items] };
      this.items = [];
      this.save();
    }
  }

  /** Recovers dropped items from world corpse container. */
  recoverDropped(): SatchelItem[] | null {
    if (!this.dropped) return null;
    const recovered = [...this.dropped.items];
    for (const item of recovered) {
      this.addItem(item.id, item.name, item.count);
    }
    this.dropped = null;
    this.save();
    return recovered;
  }
}
