import type { SoundManager } from '../audio.js';
import type { LiveTownsperson } from '../life/town-manager.js';
import {
  pickDialogueLine,
  type DialogueEventType,
  type DialogueMemory,
  type PlayerDialogueContext,
} from '../../../shared/src/story/dialogue.js';
import type { LeadManager, Lead } from '../../../shared/src/story/leads.js';
import dialogueData from '../../../shared/dialogue.json';
import type { TownVoices } from '../life/town-voices.js';
import './npc-dialogue.css';

/** One reply the player can give. */
interface Choice {
  label: string;
  run(): void;
}

/** Most replies a conversation offers at once; each has a number key. */
const MAX_CHOICES = 5;

/** The town's minds, on the server: a person's own answer to what the player says. */
export interface MindDesk {
  /** The person's reply, or null when the server cannot be reached (the written lines answer then). */
  talk(npc: LiveTownsperson, message: string, intent: 'ask' | 'gossip'): Promise<string | null>;
  /** Opens the shop a keeper keeps. */
  trade(merchantId: string): void;
}

/** What a person does while they think, in the line where their answer will appear. */
const THINKING = ['glances up, considering', 'pauses, weighing your words', 'hums under their breath', 'looks you over', 'rubs their chin'];

/**
 * The conversation panel. It is driven by keys, the mouse wheel and the left button while the mouse is
 * captured, and by taps on phones: replies are numbered, one is highlighted, and confirming runs it.
 */
export class NpcDialogueUI {
  private readonly el: HTMLElement;
  private readonly nameEl: HTMLElement;
  private readonly badgeEl: HTMLElement;
  private readonly textEl: HTMLElement;
  private readonly choicesEl: HTMLElement;
  private currentNpc: LiveTownsperson | null = null;
  private player: PlayerDialogueContext | null = null;
  private choices: Choice[] = [];
  private selected = 0;
  private open = false;
  /** Waiting for a mind's answer: the choices hold until it comes. */
  private thinking = false;
  private sayForm: HTMLFormElement | null = null;

  constructor(
    private dialogueMemory: DialogueMemory,
    private soundManager: SoundManager,
    private voices: TownVoices,
    private leadManager: LeadManager,
    private timeOfDay: () => 'day' | 'dusk' | 'night' | 'dawn',
    private onLeadPurchased?: (lead: Lead) => void,
    private mind?: MindDesk,
  ) {
    this.el = document.createElement('section');
    this.el.className = 'npc-talk';
    this.el.setAttribute('aria-live', 'polite');
    this.el.hidden = true;
    this.el.innerHTML = `
      <header class="npc-talk-header">
        <span class="npc-talk-name"></span>
        <span class="npc-talk-badge"></span>
      </header>
      <p class="npc-talk-line"></p>
      <ol class="npc-talk-choices"></ol>`;
    this.nameEl = this.el.querySelector('.npc-talk-name')!;
    this.badgeEl = this.el.querySelector('.npc-talk-badge')!;
    this.textEl = this.el.querySelector('.npc-talk-line')!;
    this.choicesEl = this.el.querySelector('.npc-talk-choices')!;
    document.body.appendChild(this.el);
  }

  isOpen(): boolean {
    return this.open;
  }

  /** Who the player is talking to, while a conversation is open. */
  get partner(): LiveTownsperson | null {
    return this.open ? this.currentNpc : null;
  }

  interact(player: PlayerDialogueContext, npc?: LiveTownsperson | null): void {
    const target = npc ?? this.currentNpc;
    if (!target) return;
    this.openDialogue(target, player);
  }

  openDialogue(npc: LiveTownsperson, player: PlayerDialogueContext, eventType: DialogueEventType = 'greeting'): void {
    this.currentNpc = npc;
    this.player = player;
    this.open = true;

    const result = pickDialogueLine(
      dialogueData as unknown as Record<string, Record<string, string[] | string>>,
      {
        id: npc.data.id,
        role: npc.data.dialogueRole,
        nation: npc.data.element,
        mood: npc.feelingScore > 65 ? 'friendly' : npc.feelingScore < 35 ? 'wary' : 'neutral',
        timeOfDay: this.timeOfDay(),
      },
      player,
      eventType,
      this.dialogueMemory,
    );
    this.say(npc, result.text);

    const roleName = npc.data.role.charAt(0).toUpperCase() + npc.data.role.slice(1);
    this.nameEl.textContent = npc.data.name;
    this.badgeEl.textContent = `${npc.data.isLit ? 'Lit' : 'Hush'} · ${roleName}`;
    this.badgeEl.classList.toggle('lit', npc.data.isLit);
    this.textEl.textContent = result.text;
    this.setChoices(this.choicesFor(npc));
    this.el.hidden = false;
  }

  private choicesFor(npc: LiveTownsperson): Choice[] {
    const mind = this.mind;
    if (!mind) {
      const choices: Choice[] = [{ label: 'Talk', run: () => this.again('talk') }];
      if (npc.data.role === 'innkeeper') {
        if (this.leadManager.getAvailableLeads().length > 0) choices.push({ label: 'Buy a lead (15 CHROMA)', run: () => this.buyLead() });
        choices.push({ label: 'Ask of the Allborn', run: () => this.again('rumour_allborn') });
      }
      choices.push({ label: 'Leave', run: () => this.close() });
      return choices.slice(0, MAX_CHOICES);
    }
    const choices: Choice[] = [{ label: "What's new?", run: () => void this.ask(npc, "What's new with you?", 'ask') }];
    if (npc.data.role === 'innkeeper') {
      if (this.leadManager.getAvailableLeads().length > 0) choices.push({ label: 'Buy a lead (15 CHROMA)', run: () => this.buyLead() });
      choices.push({ label: 'Ask of the Allborn', run: () => this.again('rumour_allborn') });
    } else {
      choices.push({ label: 'Any gossip?', run: () => void this.ask(npc, 'Heard any gossip lately?', 'gossip') });
    }
    choices.push({ label: 'Say something', run: () => this.openSay(npc) });
    const shop = npc.data.keeps;
    if (shop) choices.push({ label: 'Trade', run: () => { this.close(); mind.trade(shop); } });
    choices.push({ label: 'Leave', run: () => this.close() });
    return choices.slice(0, MAX_CHOICES);
  }

  /** Asks the person's mind: a thinking beat in the line, then their answer (or a written line if none comes). */
  private async ask(npc: LiveTownsperson, message: string, intent: 'ask' | 'gossip'): Promise<void> {
    if (!this.mind || this.thinking) return;
    this.closeSay();
    this.thinking = true;
    this.el.classList.add('thinking');
    this.textEl.textContent = `${npc.data.name.split(' ')[0]} ${THINKING[Math.floor(Math.random() * THINKING.length)]}...`;
    this.soundManager.playBark(npc.data.role, npc.data.sex);
    const reply = await this.mind.talk(npc, message, intent).catch(() => null);
    this.thinking = false;
    this.el.classList.remove('thinking');
    if (!this.open || this.currentNpc !== npc) return;
    if (reply) this.textEl.textContent = reply;
    else this.again('talk');
    this.setChoices(this.choicesFor(npc));
  }

  /** A line the player types: the choices give way to a field until it is sent or put away. */
  private openSay(npc: LiveTownsperson): void {
    this.closeSay();
    const form = document.createElement('form');
    form.className = 'npc-talk-say';
    form.innerHTML = '<input class="npc-talk-input" type="text" maxlength="200" autocomplete="off" aria-label="What you say" placeholder="Say something"><button type="submit" class="npc-talk-choice npc-talk-send">Say</button>';
    const input = form.querySelector('input')!;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (text) void this.ask(npc, text, 'ask');
      else this.closeSay();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.closeSay();
      }
    });
    this.choicesEl.hidden = true;
    this.el.appendChild(form);
    this.sayForm = form;
    input.focus();
  }

  private closeSay(): void {
    if (!this.sayForm) return;
    this.sayForm.remove();
    this.sayForm = null;
    this.choicesEl.hidden = false;
  }

  private again(event: DialogueEventType): void {
    if (this.currentNpc && this.player) this.openDialogue(this.currentNpc, this.player, event);
  }

  private buyLead(): void {
    const npc = this.currentNpc;
    const avail = this.leadManager.getAvailableLeads();
    if (!npc || avail.length === 0) return;
    const lead = this.leadManager.purchaseLead(avail[0]!.id);
    if (!lead) return;
    this.onLeadPurchased?.(lead);
    this.showLine(npc, `Here is the map mark for the ${lead.title}. Follow the amber beacon and mind your back out on the road.`);
    this.setChoices(this.choicesFor(npc));
  }

  private setChoices(choices: Choice[]): void {
    this.choices = choices;
    this.selected = 0;
    this.choicesEl.replaceChildren(...choices.map((choice, i) => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'npc-talk-choice';
      button.innerHTML = '<kbd class="npc-talk-key"></kbd><span></span>';
      button.querySelector('kbd')!.textContent = String(i + 1);
      button.querySelector('span')!.textContent = choice.label;
      button.addEventListener('click', () => this.choose(i));
      button.addEventListener('pointerenter', () => this.highlight(i));
      item.appendChild(button);
      return item;
    }));
    this.highlight(0);
  }

  private highlight(index: number): void {
    this.selected = index;
    this.choicesEl.querySelectorAll('.npc-talk-choice').forEach((b, i) => b.classList.toggle('selected', i === index));
  }

  /** Runs reply `index` (0-based). False when there is no such reply. */
  choose(index: number): boolean {
    const choice = this.open && !this.thinking && !this.sayForm ? this.choices[index] : undefined;
    if (!choice) return false;
    choice.run();
    return true;
  }

  /** Moves the highlight up (-1) or down (+1), wrapping. */
  step(direction: number): void {
    if (!this.open || this.choices.length === 0) return;
    const n = this.choices.length;
    this.highlight(((this.selected + Math.sign(direction)) % n + n) % n);
  }

  /** Runs the highlighted reply. */
  confirm(): boolean {
    return this.choose(this.selected);
  }

  showLine(npc: LiveTownsperson, lineText: string): void {
    this.textEl.textContent = lineText;
    this.say(npc, lineText);
  }

  /** Speaks the line in the person's recorded voice, from where they stand; a bark when it has no recording. */
  private say(npc: LiveTownsperson, text: string): void {
    void this.voices.say(npc, text, 'conversation')
      .then(spoken => { if (!spoken && this.currentNpc === npc && this.open) this.soundManager.playBark(npc.data.role, npc.data.sex); });
  }

  close(): void {
    if (this.currentNpc) this.voices.end(this.currentNpc.data.id);
    this.closeSay();
    this.thinking = false;
    this.el.classList.remove('thinking');
    this.open = false;
    this.el.hidden = true;
  }

  dispose(): void {
    this.el.remove();
  }
}
