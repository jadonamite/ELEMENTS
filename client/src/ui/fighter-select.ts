import './fighter-select.css';
import balance from '../../../shared/balance.json';
import type { Element } from '../../../shared/src/index.js';
import { CreatorView } from '../creator/index.js';
import { BODY_PRESET_OPTIONS, HAIR_STYLE_OPTIONS, SKIN_TONE_PRESETS, getDefaultCharacterConfig, getStoredCharacter } from '../creator/creator-types.js';

export type FighterChoice = { role: 'Shaper'; element: Element } | { role: 'Hush' };

type Slot = 'bend_palm' | 'bend_sweep' | 'uppercut' | 'ground_pound' | 'dash_strike' | 'ultimate';
type MoveNumbers = { kind: string; damage: number; reach: number; cooldownSeconds: number; name: string; heal?: number; overSeconds?: number; charges?: number };

const SLOTS: ReadonlyArray<{ slot: Slot; key: string; label: string }> = [
  { slot: 'bend_palm', key: 'Left click', label: 'Throw' },
  { slot: 'bend_sweep', key: 'Right click', label: 'Sweep' },
  { slot: 'uppercut', key: 'Q', label: 'Rise' },
  { slot: 'ground_pound', key: 'E', label: 'Ground' },
  { slot: 'dash_strike', key: 'F', label: 'Move' },
  { slot: 'ultimate', key: 'G', label: 'Ultimate' },
];

/** Plain-language text from the approved moveset sheet; numbers come from balance.json. */
const SHEETS: Record<Element, { kind: string; feel: string; source: string; weapon: string; moves: Record<Slot, string>; note?: string }> = {
  IGNIS: {
    kind: 'Fire',
    feel: 'Pressure. Everything it touches keeps hurting after the hit.',
    source: 'Anywhere.',
    weapon: 'Sword. It stays in hand while bending, and the blade catches fire.',
    moves: {
      bend_palm: 'Fireball or Lightning (V). Pierces defenses and detonates.',
      bend_sweep: 'Arc of fire in front.',
      uppercut: 'Fire pillar, launches the target.',
      ground_pound: 'Shockwave that leaves burning ground for 2 to 4 s.',
      dash_strike: 'Dash through enemies, leaving a trail of fire.',
      ultimate: 'A ring of fire rolls outward and keeps burning where it passed.',
    },
    note: 'Lightning Bending: Press V while lit to unleash an electrical strike. Weak naturally against wind and water, but the most aggressive.',
  },
  AQUES: {
    kind: 'Water',
    feel: 'Control. Slows, pulls, freezes, and outlasts.',
    source: 'Water within reach is infinite and reusable. Waterskin holds 5 moves when away from water.',
    weapon: 'Sword, put away while bending: AQUES bends bare-handed. Drawing it turns bending off.',
    moves: {
      bend_palm: 'Water whip. Pulls the target 1.5 m toward you.',
      bend_sweep: 'Arc of water that knocks back and leaves a pool slowing enemies 30% for 3 s.',
      uppercut: 'Water bursts from below and launches.',
      ground_pound: 'Turns water around you to ice. Enemies on it slow 50% for 2 s and count as frozen.',
      dash_strike: 'Mend. Restores HP based on water quality (Wellspring water +150%). Cannot cure deep internal scars.',
      ultimate: 'A wave crashes forward, knocks everyone down and floods the ground for 6 s.',
    },
    note: 'Moon tide: under a full moon, water strikes 20% harder. Ice combo: shatters frozen enemies for 30% bonus damage.',
  },
  TERRA: {
    kind: 'Earth',
    feel: 'Weight. The slowest moves, the biggest hits, and the only element that can hide.',
    source: 'Earth underfoot: stone, soil or sand. Not wood.',
    weapon: 'Sword, put away while bending: TERRA bends bare-handed. Drawing it turns bending off.',
    moves: {
      bend_palm: 'Rips a rock up and hurls it. Can be redirected by air or water; staggers.',
      bend_sweep: 'A line of stone spikes along the ground; trips.',
      uppercut: 'A stone column shoots up under the target and launches it.',
      ground_pound: 'Raises a stone wall in front for 5 s. It physically blocks all elemental attacks.',
      dash_strike: 'Short heavy charge; knocks down whoever it hits.',
      ultimate: 'Tears up the ground and brings it down; everyone inside is stunned for 1 s.',
    },
    note: 'Stonehearing (V): Senses ground vibrations to detect enemy positions and footfalls through walls.',
  },
  AURA: {
    kind: 'Air',
    feel: 'Speed. Never where you swing; hits from range and pushes you out of yours.',
    source: 'Anywhere.',
    weapon: 'Sword, put away while bending. A staff, war fans or a glider can stay in hand while bending.',
    moves: {
      bend_palm: 'Fast blade of air that passes through the first enemy into the next.',
      bend_sweep: 'Cone of wind that shoves enemies 4 m away.',
      uppercut: 'Lifts the target and you together; you hang in the air for 0.6 s.',
      ground_pound: 'A whirlwind that holds enemies in place.',
      dash_strike: 'Wind Step / Windskiff (V): Balance atop a spinning ball of air and ride it at high speed.',
      ultimate: 'A storm around you for 4 s, cutting and pushing everyone outward.',
    },
    note: 'Counters: Wind extinguishes fire. Wind and water can deflect and redirect incoming boulders.',
  },
};

const ORDER: ReadonlyArray<FighterChoice> = [
  { role: 'Shaper', element: 'IGNIS' },
  { role: 'Shaper', element: 'AQUES' },
  { role: 'Shaper', element: 'TERRA' },
  { role: 'Shaper', element: 'AURA' },
  { role: 'Hush' },
];

const LAST_FIGHTER_KEY = 'elements_test_fighter';

/** The fighter last picked in this tab, so a reload keeps it. */
export function lastFighter(): FighterChoice | null {
  try {
    const raw = sessionStorage.getItem(LAST_FIGHTER_KEY);
    return raw ? (JSON.parse(raw) as FighterChoice) : null;
  } catch {
    return null;
  }
}

function characterSummary(): string {
  const c = getStoredCharacter() ?? getDefaultCharacterConfig('male');
  const body = BODY_PRESET_OPTIONS.find(b => b.id === c.bodyPreset)?.name ?? c.bodyPreset;
  const skin = SKIN_TONE_PRESETS.find(t => t.id === c.skinToneId)?.name ?? c.skinToneId;
  const hair = HAIR_STYLE_OPTIONS.find(h => h.id === c.hairStyleId)?.name ?? c.hairStyleId;
  return `${c.sex === 'male' ? 'Male' : 'Female'}, ${body.toLowerCase()} build, ${skin.toLowerCase()} skin, ${hair.toLowerCase()} hair`;
}

const keyOf = (c: FighterChoice): string => c.role === 'Hush' ? 'HUSH' : c.element;
const titleCase = (s: string): string => s.charAt(0) + s.slice(1).toLowerCase();

function damageText(m: MoveNumbers): string {
  if (m.kind === 'heal') return `Heals ${m.heal ?? 0}`;
  if (m.kind === 'dodge') return '—';
  return m.overSeconds ? `${m.damage}<span class="fs-slot">over ${m.overSeconds} s</span>` : String(m.damage);
}

function cooldownText(m: MoveNumbers): string {
  return m.charges ? `${m.cooldownSeconds} s<span class="fs-slot">${m.charges} charges</span>` : `${m.cooldownSeconds} s`;
}

function shaperSheet(element: Element): string {
  const sheet = SHEETS[element];
  const numbers = balance.combat.elements[element] as Record<Slot, MoveNumbers>;
  const rows = SLOTS.map(({ slot, key, label }) => {
    const m = numbers[slot];
    return `<tr>
      <td><kbd>${key}</kbd></td>
      <th scope="row"><span class="fs-move">${m.name}</span><span class="fs-slot">${label}</span></th>
      <td class="fs-num">${damageText(m)}</td>
      <td class="fs-num">${m.reach ? `${m.reach} m` : 'Self'}</td>
      <td class="fs-num">${cooldownText(m)}</td>
      <td class="fs-what">${sheet.moves[slot]}</td>
    </tr>`;
  }).join('');
  return `
    <p class="fs-kicker">Shaper of</p>
    <h2 id="fs-name">${element}</h2>
    <p class="fs-feel">${sheet.feel}</p>
    <dl class="fs-facts">
      <div><dt>Bends from</dt><dd>${sheet.source}</dd></div>
      <div><dt>Weapon</dt><dd>${sheet.weapon}</dd></div>
    </dl>
    <table class="fs-moves">
      <caption>Bending</caption>
      <thead><tr><th scope="col">Key</th><th scope="col">Move</th><th scope="col">Damage</th><th scope="col">Reach</th><th scope="col">Cooldown</th><th scope="col">What it does</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${sheet.note ? `<p class="fs-note">${sheet.note}</p>` : ''}
    <p class="fs-note">Press <kbd>B</kbd> to turn bending on; Q, E and F need it, and G turns it on by itself. The test arena plays at tier 5, so every move is open.</p>`;
}

function hushSheet(): string {
  const { parry, shardSpark, weapons } = balance.combat;
  const sword = weapons.sword;
  return `
    <p class="fs-kicker">Born without an element</p>
    <h2 id="fs-name">The Hush</h2>
    <p class="fs-feel">Craft. No bending, but the widest parry and the surest hands with a weapon.</p>
    <dl class="fs-facts">
      <div><dt>Bends from</dt><dd>Never. Carried shards give a single weak spark.</dd></div>
      <div><dt>Weapon</dt><dd>Sword, hands and legs, like everyone.</dd></div>
    </dl>
    <table class="fs-moves">
      <caption>Fighting</caption>
      <thead><tr><th scope="col">Key</th><th scope="col">Move</th><th scope="col">Damage</th><th scope="col">Reach</th><th scope="col">Cooldown</th><th scope="col">What it does</th></tr></thead>
      <tbody>
        <tr><td><kbd>Left click</kbd></td><th scope="row"><span class="fs-move">Light combo</span><span class="fs-slot">Weapon</span></th><td class="fs-num">${sword.light_1.damage} / ${sword.light_2.damage} / ${sword.light_3.damage}</td><td class="fs-num">${sword.light_3.reach} m</td><td class="fs-num">${sword.light_1.cooldownSeconds} s</td><td class="fs-what">Three quick cuts in a row.</td></tr>
        <tr><td><kbd>Right click</kbd></td><th scope="row"><span class="fs-move">Heavy</span><span class="fs-slot">Weapon</span></th><td class="fs-num">${sword.heavy_1.damage} / ${sword.heavy_2.damage}</td><td class="fs-num">${sword.heavy_1.reach} m</td><td class="fs-num">${sword.heavy_1.cooldownSeconds} s</td><td class="fs-what">Two slow, heavy blows.</td></tr>
        <tr><td><kbd>R</kbd></td><th scope="row"><span class="fs-move">Parry</span><span class="fs-slot">Guard</span></th><td class="fs-num">—</td><td class="fs-num">—</td><td class="fs-num">—</td><td class="fs-what">Block within ${parry.hushWindow} s of a hit landing and the attacker staggers for ${parry.hushStagger} s. Other fighters get ${parry.window} s.</td></tr>
        <tr><td><kbd>Q</kbd></td><th scope="row"><span class="fs-move">Shard Spark</span><span class="fs-slot">Shard</span></th><td class="fs-num">${Math.round(shardSpark.damageScale * 100)}%<span class="fs-slot">of a throw</span></td><td class="fs-num">—</td><td class="fs-num">${shardSpark.cooldownSeconds} s</td><td class="fs-what">Spends a shard to throw a weak spark of its element. No burning, pull or pierce.</td></tr>
      </tbody>
    </table>
    <p class="fs-note">For testing, a Hush starts each fight with ${shardSpark.testShards} shards of a random element. Keys <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> switch weapon, hands and legs.</p>`;
}

/** Picks who the player goes into the arena with, and shows that fighter's sheet. */
export class FighterSelect {
  private readonly root: HTMLDivElement;
  private readonly sheet: HTMLElement;
  private readonly enter: HTMLButtonElement;
  private readonly options: HTMLButtonElement[] = [];
  private choice: FighterChoice;
  private dismissable = false;

  constructor(initial: FighterChoice, private readonly onChange: (choice: FighterChoice) => void, private readonly onEnter: () => void) {
    this.choice = initial;
    this.root = document.createElement('div');
    this.root.id = 'fighter-select';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-labelledby', 'fs-title');
    this.root.innerHTML = `
      <h1 id="fs-title">Choose your fighter</h1>
      <div class="fs-left">
        <div class="fs-roster" role="radiogroup" aria-label="Fighter"></div>
        <section class="fs-character" aria-labelledby="fs-character-title">
          <h3 id="fs-character-title">Character</h3>
          <p class="fs-character-summary"></p>
          <button type="button" class="fs-character-change">Change character</button>
        </section>
      </div>
      <div class="fs-sheet"><article class="fs-card" aria-live="polite"></article></div>
      <div class="fs-footer">
        <button type="button" class="fs-enter"></button>
        <p class="fs-hint"><kbd>Up</kbd> <kbd>Down</kbd> choose <kbd>Enter</kbd> start</p>
      </div>`;
    const roster = this.root.querySelector<HTMLDivElement>('.fs-roster')!;
    for (const option of ORDER) {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.dataset.fighter = keyOf(option);
      b.innerHTML = option.role === 'Hush'
        ? '<span class="fs-opt-name">Hush</span><span class="fs-opt-kind">No bending</span>'
        : `<span class="fs-opt-name">${titleCase(option.element)}</span><span class="fs-opt-kind">${SHEETS[option.element].kind}</span>`;
      b.addEventListener('click', () => this.pick(option, true));
      roster.appendChild(b);
      this.options.push(b);
    }
    this.sheet = this.root.querySelector<HTMLElement>('.fs-card')!;
    this.enter = this.root.querySelector<HTMLButtonElement>('.fs-enter')!;
    this.enter.addEventListener('click', () => { this.close(); this.onEnter(); });
    this.root.querySelector<HTMLElement>('.fs-character-summary')!.textContent = characterSummary();
    this.root.querySelector<HTMLButtonElement>('.fs-character-change')!.addEventListener('click', () => this.openCreator());
    this.root.addEventListener('keydown', this.onKey);
    this.render();
  }

  /** Shows the picker; `dismissable` lets Escape close it without entering. */
  open(dismissable = false): void {
    this.dismissable = dismissable;
    if (!this.root.isConnected) document.body.appendChild(this.root);
    document.body.classList.add('selecting');
    this.options[this.index()]?.focus();
  }

  close(): void {
    this.root.remove();
    document.body.classList.remove('selecting');
  }

  /** Moves the highlight without telling the game (used when the rising decides). */
  set(choice: FighterChoice): void {
    this.choice = choice;
    this.render();
  }

  dispose(): void {
    this.close();
    this.root.removeEventListener('keydown', this.onKey);
  }

  private index(): number {
    return ORDER.findIndex(o => keyOf(o) === keyOf(this.choice));
  }

  private pick(choice: FighterChoice, focus: boolean): void {
    if (keyOf(choice) === keyOf(this.choice)) return;
    this.choice = choice;
    this.render();
    if (focus) this.options[this.index()]?.focus();
    try { sessionStorage.setItem(LAST_FIGHTER_KEY, JSON.stringify(choice)); } catch { /* private mode */ }
    this.onChange(choice);
  }

  /** Opens the character creator; confirming saves the body and reloads, keeping the fighter. */
  private openCreator(): void {
    try { sessionStorage.setItem(LAST_FIGHTER_KEY, JSON.stringify(this.choice)); } catch { /* private mode */ }
    const overlay = document.createElement('div');
    overlay.id = 'opening-overlay';
    overlay.classList.add('fs-creator');
    document.body.appendChild(overlay);
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'fs-creator-back';
    back.textContent = 'Back';
    let view: CreatorView | null = null;
    const leave = (): void => { view?.dispose(); overlay.remove(); this.options[this.index()]?.focus(); };
    back.addEventListener('click', leave);
    view = new CreatorView(overlay, () => { overlay.remove(); window.location.reload(); });
    overlay.appendChild(back);
    overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); leave(); } });
    back.focus();
  }

  private readonly onKey = (event: KeyboardEvent): void => {
    const i = this.index();
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      event.preventDefault();
      this.pick(ORDER[(i + 1) % ORDER.length]!, true);
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      event.preventDefault();
      this.pick(ORDER[(i - 1 + ORDER.length) % ORDER.length]!, true);
    } else if (event.key === 'Enter' && event.target !== this.enter) {
      event.preventDefault();
      this.enter.click();
    } else if (event.key === 'Escape' && this.dismissable) {
      event.preventDefault();
      this.close();
    }
  };

  private render(): void {
    const key = keyOf(this.choice);
    this.root.dataset.fighter = key;
    for (const b of this.options) {
      const on = b.dataset.fighter === key;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    }
    this.sheet.innerHTML = this.choice.role === 'Hush' ? hushSheet() : shaperSheet(this.choice.element);
    this.enter.textContent = this.choice.role === 'Hush' ? 'Enter as the Hush' : `Enter as ${titleCase(this.choice.element)}`;
  }
}
