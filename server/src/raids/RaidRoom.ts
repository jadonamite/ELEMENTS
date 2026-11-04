import { Room, type Client } from '@colyseus/core';
import { verifyToken } from '../auth.js';
import { RaidError, type RaidService } from './service.js';

/**
 * A private copy of a dungeon for one party, as a live room. Clients join with the run id; the room
 * is filtered by run id so each party gets its own instance, and only that run's members get in.
 * It forwards to the same RaidService the web routes use, so both paths keep one set of rules.
 * Register with: server.define('raid', RaidRoom, { raids }).filterBy(['runId']).
 */
export class RaidRoom extends Room {
  maxClients = 5;
  private raids!: RaidService;
  private runId = '';

  override onCreate(options: { runId?: string; raids: RaidService }): void {
    this.raids = options.raids;
    this.runId = options.runId ?? '';
    const act = (name: string, fn: (accountId: string, body: Record<string, unknown>) => unknown): void => {
      this.onMessage(name, (client: Client, body: Record<string, unknown>) => {
        try {
          const result = fn(client.auth as string, body ?? {});
          this.broadcast('run', this.raids.run(this.runId));
          client.send(`${name}:ok`, result);
        } catch (err) {
          client.send(`${name}:error`, err instanceof RaidError ? err.message : 'failed');
        }
      });
    };
    act('presence', (a, b) => this.raids.presence(a, this.runId, { x: Number(b.x), z: Number(b.z), hp: Number(b.hp), maxHp: Number(b.maxHp) }));
    act('clear', (a, b) => this.raids.clear(a, this.runId, String(b.roomId), (b.kills ?? {}) as Record<string, number>));
    act('down', (a) => this.raids.down(a, this.runId));
    act('abandon', (a) => this.raids.abandon(a, this.runId));
    act('fighter-killed', (a, b) => this.raids.fighterKilled(a, this.runId, String(b.fighterId)));
  }

  override async onAuth(_client: Client, options: { token?: string }): Promise<string> {
    const { userId } = await verifyToken(options.token);
    const run = this.raids.run(this.runId);
    if (!run || !run.members.includes(userId)) throw new Error('This ruin belongs to another party');
    return userId;
  }
}
