import type { SoundManager } from '../audio.js';
import type { LiveTownsperson } from '../life/town-manager.js';
import {
  pickDialogueLine,
  type DialogueMemory,
  type PlayerDialogueContext,
} from '../../../shared/src/story/dialogue.js';
import type { LeadManager, Lead } from '../../../shared/src/story/leads.js';
import dialogueData from '../../../shared/dialogue.json';

export class NpcDialogueUI {
  private dialogueEl: HTMLElement;
  private currentNpc: LiveTownsperson | null = null;
  private open = false;

  constructor(
    private dialogueMemory: DialogueMemory,
    private soundManager: SoundManager,
    private leadManager: LeadManager,
    private onLeadPurchased?: (lead: Lead) => void,
  ) {
    this.dialogueEl = document.createElement('div');
    this.dialogueEl.id = 'npc-dialogue-box';
    this.dialogueEl.className = 'npc-dialogue-card';
    this.dialogueEl.style.display = 'none';
    document.body.appendChild(this.dialogueEl);

    this.setupStyles();
  }

  private setupStyles(): void {
    const style = document.createElement('style');
    style.id = 'life-story-styles';
    style.textContent = `
      .npc-dialogue-card {
        position: fixed;
        bottom: 110px;
        left: 50%;
        transform: translateX(-50%);
        width: 520px;
        max-width: 90vw;
        background: rgba(18, 16, 20, 0.94);
        border: 1px solid #784824;
        padding: 16px 20px;
        color: #e6dfd5;
        font-family: sans-serif;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.8);
        z-index: 105;
      }
      .dialogue-header {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        border-bottom: 1px solid #3a2818;
        padding-bottom: 8px;
        margin-bottom: 12px;
      }
      .dialogue-name {
        font-size: 16px;
        font-weight: bold;
        color: #e8b060;
        letter-spacing: 0.04em;
      }
      .dialogue-badge {
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        padding: 2px 8px;
        border: 1px solid #5a3820;
        color: #c49a70;
      }
      .dialogue-badge.lit {
        border-color: #a42818;
        color: #ff6a4a;
        background: rgba(160, 40, 20, 0.2);
      }
      .dialogue-badge.hush,
      .dialogue-badge.dim {
        border-color: #4a5460;
        color: #a0b2c6;
        background: rgba(40, 50, 60, 0.2);
      }
      .dialogue-text {
        font-size: 15px;
        line-height: 1.45;
        color: #d8d0c4;
        margin-bottom: 14px;
        min-height: 42px;
      }
      .dialogue-actions {
        display: flex;
        gap: 10px;
      }
      .dialogue-btn {
        background: #2a2018;
        border: 1px solid #8c5828;
        color: #f0e6d6;
        padding: 6px 14px;
        font-size: 13px;
        cursor: pointer;
        transition: background 0.15s, border-color 0.15s;
      }
      .dialogue-btn:hover {
        background: #4a3420;
        border-color: #d88838;
      }
      .dialogue-btn.secondary {
        background: transparent;
        border-color: #4a3c30;
        color: #a09484;
      }
      .dialogue-btn.secondary:hover {
        border-color: #706050;
        color: #e0d4c4;
      }
      .lead-marker-hud {
        position: fixed;
        pointer-events: none;
        z-index: 95;
      }
      .lead-marker-badge {
        background: rgba(14, 12, 16, 0.88);
        border: 1px solid #d89830;
        padding: 4px 10px;
        display: flex;
        align-items: center;
        gap: 8px;
        color: #f4eae0;
        font-family: sans-serif;
        font-size: 12px;
        letter-spacing: 0.04em;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
      }
      .lead-marker-badge.offscreen {
        border-color: #886020;
        opacity: 0.85;
      }
      .lead-marker-title {
        font-weight: 600;
        color: #f8c850;
      }
      .lead-marker-dist {
        color: #a8a090;
        font-size: 11px;
      }
    `;
    document.head.appendChild(style);
  }

  isOpen(): boolean {
    return this.open;
  }

  interact(player: PlayerDialogueContext, npc?: LiveTownsperson | null): void {
    if (this.open) {
      this.close();
      return;
    }

    const target = npc ?? this.currentNpc;
    if (!target) return;
    this.openDialogue(target, player);
  }

  openDialogue(npc: LiveTownsperson, player: PlayerDialogueContext, eventType = 'greeting'): void {
    this.currentNpc = npc;
    this.open = true;

    // Pick line from dialogue table
    const result = pickDialogueLine(
      dialogueData as unknown as Record<string, Record<string, string[] | string>>,
      {
        id: npc.data.id,
        role: npc.data.dialogueRole,
        nation: npc.data.element,
        mood: npc.feelingScore > 65 ? 'friendly' : npc.feelingScore < 35 ? 'wary' : 'neutral',
      },
      player,
      eventType as any,
      this.dialogueMemory,
    );

    // Play vocal bark sound
    this.soundManager.playBark(npc.data.role, npc.data.sex);

    const roleName = npc.data.role.charAt(0).toUpperCase() + npc.data.role.slice(1);
    const badgeClass = npc.data.isLit ? 'lit' : 'hush';
    const badgeLabel = npc.data.isLit ? 'Lit IGNIS' : 'Hush';

    let actionsHtml = `<button type="button" class="dialogue-btn" id="dialogue-more-btn">Talk</button>`;
    if (npc.data.role === 'innkeeper') {
      const avail = this.leadManager.getAvailableLeads();
      if (avail.length > 0) {
        actionsHtml += `<button type="button" class="dialogue-btn" id="dialogue-lead-btn">Buy Lead (15 CHROMA)</button>`;
      }
      actionsHtml += `<button type="button" class="dialogue-btn" id="dialogue-rumour-btn">Ask of the Allborn</button>`;
    }
    actionsHtml += `<button type="button" class="dialogue-btn secondary" id="dialogue-close-btn">Close</button>`;

    this.dialogueEl.innerHTML = `
      <div class="dialogue-header">
        <span class="dialogue-name">${npc.data.name}</span>
        <span class="dialogue-badge ${badgeClass}">${badgeLabel} (${roleName})</span>
      </div>
      <div class="dialogue-text">${result.text}</div>
      <div class="dialogue-actions">${actionsHtml}</div>
    `;
    this.dialogueEl.style.display = 'block';

    // Wire buttons
    const closeBtn = this.dialogueEl.querySelector('#dialogue-close-btn');
    closeBtn?.addEventListener('click', () => this.close());

    const moreBtn = this.dialogueEl.querySelector('#dialogue-more-btn');
    moreBtn?.addEventListener('click', () => {
      this.openDialogue(npc, player, 'talk');
    });

    const leadBtn = this.dialogueEl.querySelector('#dialogue-lead-btn');
    leadBtn?.addEventListener('click', () => {
      const avail = this.leadManager.getAvailableLeads();
      if (avail.length > 0) {
        const lead = this.leadManager.purchaseLead(avail[0]!.id);
        if (lead) {
          this.onLeadPurchased?.(lead);
          this.showLine(npc, `Here is the map mark for the ${lead.title}. Follow the amber beacon and mind your back out on the road.`);
        }
      }
    });

    const rumourBtn = this.dialogueEl.querySelector('#dialogue-rumour-btn');
    rumourBtn?.addEventListener('click', () => {
      this.openDialogue(npc, player, 'rumour_allborn');
    });
  }

  showLine(npc: LiveTownsperson, lineText: string): void {
    const textEl = this.dialogueEl.querySelector('.dialogue-text');
    if (textEl) {
      textEl.textContent = lineText;
      this.soundManager.playBark(npc.data.role, npc.data.sex);
    }
  }

  close(): void {
    this.open = false;
    this.dialogueEl.style.display = 'none';
  }

  dispose(): void {
    this.dialogueEl.remove();
    document.getElementById('life-story-styles')?.remove();
  }
}
