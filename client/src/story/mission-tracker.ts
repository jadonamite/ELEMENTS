import { currentObjective, missionJournal, type ArrivalProgress, type JournalMission, type MissionState } from '../../../shared/src/story/missions.js';
import './mission-tracker.css';

/** What the tracker reads each frame: the saved mission, and the arrival before the server holds one. */
export interface TrackerSource {
  state(): MissionState | null;
  arrival(): ArrivalProgress;
  /** Hidden while a cinematic or a menu has the screen. */
  hidden(): boolean;
}

/**
 * The player's missions: the one under way and its next step on screen, and the whole journal in the menu.
 * Both are drawn from the same journal and redrawn only when it changes.
 */
export class MissionTracker {
  private readonly root = document.createElement('section');
  private readonly title = document.createElement('p');
  private readonly step = document.createElement('p');
  private journalHost: HTMLElement | null = null;
  private shown = '';
  private hiddenNow = true;

  constructor(private readonly source: TrackerSource) {
    this.root.className = 'mission-tracker';
    this.root.setAttribute('aria-label', 'Current mission');
    this.root.setAttribute('aria-live', 'polite');
    this.title.className = 'mission-tracker-title';
    this.step.className = 'mission-tracker-step';
    const kicker = document.createElement('p');
    kicker.className = 'mission-tracker-kicker';
    kicker.textContent = 'Mission';
    this.root.append(kicker, this.title, this.step);
    this.root.hidden = true;
    document.body.appendChild(this.root);
  }

  /** The menu's Missions pane, filled with the journal. */
  mountJournal(host: HTMLElement): void {
    this.journalHost = host;
    this.shown = '';
  }

  update(): void {
    const journal = missionJournal(this.source.state(), this.source.arrival());
    const key = JSON.stringify(journal);
    if (key !== this.shown) {
      this.shown = key;
      const objective = currentObjective(journal);
      this.title.textContent = objective?.title ?? '';
      this.step.textContent = objective?.step ?? '';
      if (this.journalHost) this.journalHost.replaceChildren(...journal.map(missionEntry));
    }
    const hide = this.source.hidden() || !this.title.textContent;
    if (hide !== this.hiddenNow) { this.hiddenNow = hide; this.root.hidden = hide; }
  }

  dispose(): void {
    this.root.remove();
    this.journalHost?.replaceChildren();
  }
}

const STATUS: Record<JournalMission['status'], string> = { done: 'Done', current: 'Under way', ahead: 'Not started' };

function missionEntry(mission: JournalMission): HTMLElement {
  const entry = document.createElement('article');
  entry.className = `mission-entry is-${mission.status}`;
  const head = document.createElement('header');
  const name = document.createElement('h3');
  name.textContent = mission.title;
  const status = document.createElement('span');
  status.className = 'mission-entry-status';
  status.textContent = STATUS[mission.status];
  head.append(name, status);
  entry.appendChild(head);
  // Steps not reached yet stay hidden, as does a mission not started: they would give the story away.
  if (mission.status !== 'ahead') {
    const list = document.createElement('ol');
    for (const step of mission.steps) {
      const item = document.createElement('li');
      item.textContent = step.text;
      item.className = step.done ? 'is-done' : 'is-next';
      list.appendChild(item);
      if (!step.done) break;
    }
    entry.appendChild(list);
  }
  return entry;
}
