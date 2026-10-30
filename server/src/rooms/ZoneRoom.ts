import { Room, type Client } from '@colyseus/core';
import fs from 'node:fs';
import {
  createCombatRules,
  type ActionState,
  type CombatBalance,
  type Element,
} from '@elements/shared';
import { MonsterState, PlayerState, ZoneState } from '../schema/ZoneState.js';
import { getAccount, saveAccount } from '../db.js';

const balancePath = new URL('../../../shared/balance.json', import.meta.url);
const balance = JSON.parse(fs.readFileSync(balancePath, 'utf8'));
const rules = createCombatRules(balance.combat as CombatBalance);

export function testBannedWords(text: string): boolean {
  return /\b(fire|water|earth|air|wind)\b/i.test(text);
}

export function redactBannedWords(text: string): string {
  return text.replace(/\b(fire|water|earth|air|wind)\b/gi, '[REDACTED BY EDICT]');
}

interface MoveMessage {
  x: number;
  y: number;
  z: number;
  facing: number;
  action?: string;
}

interface HitMessage {
  targetId: string;
  moveId: string;
  now: number;
  swingAt?: number;
}

interface ChatMessage {
  text: string;
}

interface AccountSyncMessage {
  id: string;
  role: 'Shaper' | 'Hush';
  element?: 'IGNIS' | 'AQUES' | 'TERRA' | 'AURA';
}

export class ZoneRoom extends Room<{ state: ZoneState }> {
  maxClients = 50;
  private playerStates = new Map<string, ActionState>();
  private zoneClock = 0;

  override onCreate(options: { zone?: string }): void {
    this.setState(new ZoneState());
    const zoneName = options.zone ?? 'arena';
    console.log(`ZoneRoom created for zone: ${zoneName}`);

    // Spawn 3 initial monsters in the zone
    for (let i = 1; i <= 3; i++) {
      const angle = (i * Math.PI * 2) / 3;
      const radius = 7.5;
      const monster = new MonsterState();
      monster.id = `husk_${i}`;
      monster.x = Math.cos(angle) * radius;
      monster.y = 0;
      monster.z = Math.sin(angle) * radius;
      monster.facing = angle + Math.PI;
      monster.element = 'TERRA';
      monster.health = 60;
      monster.maxHealth = 60;
      monster.state = 'idle';
      this.state.monsters.set(monster.id, monster);
    }

    // Fixed server tick for time and cooldowns
    this.setSimulationInterval((deltaTime) => {
      this.zoneClock += deltaTime / 1000;
    });

    this.onMessage('move', (client: Client, message: MoveMessage) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      player.x = message.x;
      player.y = message.y;
      player.z = message.z;
      player.facing = message.facing;
      if (message.action !== undefined) {
        player.action = message.action;
      }
    });

    this.onMessage('hit', (client: Client, message: HitMessage) => {
      const player = this.state.players.get(client.sessionId);
      const monster = this.state.monsters.get(message.targetId);
      if (!player || !monster) {
        client.send('hit_rejected', { reason: 'target_missing' });
        return;
      }

      const playerActionState = this.playerStates.get(client.sessionId) ?? rules.createActionState();
      const attacker = {
        element: (player.element as Element) ?? 'IGNIS',
        position: { x: player.x, y: player.y, z: player.z },
        health: { current: player.health, maximum: player.maxHealth },
        armour: 0,
      };

      const target = {
        element: (monster.element as Element) ?? 'TERRA',
        position: { x: monster.x, y: monster.y, z: monster.z },
        health: { current: monster.health, maximum: monster.maxHealth },
        armour: 0,
      };

      const check = rules.checkHit({
        attacker,
        target,
        moveId: message.moveId,
        now: this.zoneClock,
        state: playerActionState,
        swingAt: message.swingAt ?? this.zoneClock,
      });

      if (!check.accepted) {
        client.send('hit_rejected', { reason: check.reason });
        return;
      }

      this.playerStates.set(client.sessionId, check.state);
      monster.health = check.target.health.current;

      client.send('hit_accepted', {
        targetId: message.targetId,
        damage: check.damage,
      });

      this.broadcast('monster_hit', {
        targetId: message.targetId,
        damage: check.damage,
        currentHealth: monster.health,
        maxHealth: monster.maxHealth,
        hitBy: client.sessionId,
      });

      if (monster.health <= 0) {
        monster.state = 'dead';
        this.broadcast('monster_killed', {
          targetId: message.targetId,
          killedBy: client.sessionId,
        });

        // Respawn monster after 8 seconds
        this.clock.setTimeout(() => {
          if (this.state.monsters.has(message.targetId)) {
            const respawned = this.state.monsters.get(message.targetId)!;
            respawned.health = respawned.maxHealth;
            respawned.state = 'idle';
            this.broadcast('monster_respawned', { targetId: message.targetId });
          }
        }, 8000);
      }
    });

    this.onMessage('chat', (client: Client, message: ChatMessage) => {
      const text = message.text?.trim();
      if (!text) return;

      const hasBanished = testBannedWords(text);
      if (hasBanished) {
        // Redact text and announce Edict fine
        const redacted = redactBannedWords(text);
        this.broadcast('chat', {
          sender: client.sessionId,
          text: redacted,
          violation: true,
        });
        this.broadcast('chat_announcement', {
          text: `The Collector: ${client.sessionId} has violated the Edict of Unnaming. A fine of 10 CHROMA is levied to the Treasury.`,
        });
      } else {
        this.broadcast('chat', {
          sender: client.sessionId,
          text,
        });
      }
    });

    this.onMessage('account_sync', (client: Client, message: AccountSyncMessage) => {
      if (!message.id) return;
      const account = saveAccount(message.id, message.role, message.element);
      const player = this.state.players.get(client.sessionId);
      if (player) {
        player.role = account.role;
        player.element = account.element ?? 'IGNIS';
      }
      client.send('account_synced', account);
    });
  }

  override onJoin(client: Client, options: { role?: string; element?: string }): void {
    const player = new PlayerState();
    player.id = client.sessionId;
    player.x = 0;
    player.y = 0;
    player.z = 0;
    player.facing = 0;
    player.role = options.role ?? 'Shaper';
    player.element = options.element ?? 'IGNIS';
    player.health = 120;
    player.maxHealth = 120;

    this.state.players.set(client.sessionId, player);
    this.playerStates.set(client.sessionId, rules.createActionState());
    console.log(`Player joined: ${client.sessionId} (${player.element})`);
  }

  override onLeave(client: Client): void {
    this.state.players.delete(client.sessionId);
    this.playerStates.delete(client.sessionId);
    console.log(`Player left: ${client.sessionId}`);
  }
}
