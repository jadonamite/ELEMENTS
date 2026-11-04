import type { Application, Request, Response } from 'express';
import { verifyToken } from '../auth.js';
import { RAIDS } from './config.js';
import { RaidError, type RaidService } from './service.js';

function token(req: Request): string | null {
  const h = req.headers.authorization;
  if (typeof h === 'string' && h.startsWith('Bearer ')) return h.slice(7).trim() || null;
  return null;
}

type Handler = (accountId: string, body: Record<string, unknown>, req: Request) => unknown | Promise<unknown>;

/** Every raid route needs a signed-in player; the account comes from the token, never from the body. */
export function setupRaidApi(app: Application, raids: RaidService): void {
  const route = (method: 'get' | 'post', path: string, fn: Handler): void => {
    app[method](path, async (req: Request, res: Response) => {
      const t = token(req);
      if (!t) { res.status(401).json({ error: 'Missing auth token' }); return; }
      let accountId: string;
      try { accountId = (await verifyToken(t)).userId; } catch { res.status(401).json({ error: 'Invalid auth token' }); return; }
      try {
        res.json({ ok: true, result: await fn(accountId, (req.body ?? {}) as Record<string, unknown>, req) });
      } catch (err) {
        const known = err instanceof RaidError;
        if (!known) console.error('raid route failed', err);
        res.status(known ? 400 : 500).json({ error: known ? err.message : 'Something went wrong' });
      }
    });
  };
  const str = (v: unknown): string => (typeof v === 'string' ? v : '');
  const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v));

  route('get', '/api/raids/board', (a) => raids.board(a));
  route('get', '/api/raids/config', () => ({ dungeons: RAIDS.dungeons, itemKinds: RAIDS.itemKinds, keys: RAIDS.keys, party: RAIDS.party }));

  route('post', '/api/raids/party/create', (a) => raids.createParty(a));
  route('post', '/api/raids/party/invite', (a, b) => raids.invite(a, str(b.target)));
  route('post', '/api/raids/party/accept', (a, b) => raids.acceptInvite(a, str(b.partyId)));
  route('post', '/api/raids/party/leave', (a) => raids.leave(a));
  route('post', '/api/raids/party/kick', (a, b) => raids.kick(a, str(b.member)));
  route('post', '/api/raids/party/loot-rule', (a, b) => raids.setLootRule(a, str(b.rule) as never));
  route('post', '/api/raids/party/needs', (a, b) => raids.setNeeds(a, Array.isArray(b.kinds) ? b.kinds.map(String) : []));

  route('post', '/api/raids/hall/buy-key', (a, b) => raids.buyKey(a, str(b.keyId)));
  route('post', '/api/raids/hall/hire', (a, b) => raids.hire(a, str(b.fighterId)));
  route('post', '/api/raids/hall/dismiss', (a, b) => raids.dismiss(a, str(b.fighterId)));
  route('post', '/api/raids/hall/complain', (a, b) => raids.fileComplaint(a, str(b.kind) as never, str(b.against), str(b.runId) || null, str(b.note)));

  route('post', '/api/raids/run/enter', (a, b) => raids.enter(a, str(b.dungeonId)));
  route('get', '/api/raids/run/:runId', (a, _b, req) => raids.view(a, str(req.params.runId)));
  route('post', '/api/raids/run/:runId/presence', (a, b, req) => raids.presence(a, str(req.params.runId), { x: num(b.x), z: num(b.z), hp: num(b.hp), maxHp: num(b.maxHp) }));
  route('post', '/api/raids/run/:runId/clear', (a, b, req) => raids.clear(a, str(req.params.runId), str(b.roomId),
    typeof b.kills === 'object' && b.kills ? Object.fromEntries(Object.entries(b.kills).map(([k, v]) => [k, num(v)])) : {}, str(b.bossKiller) || undefined));
  route('post', '/api/raids/run/:runId/down', (a, _b, req) => raids.down(a, str(req.params.runId)));
  route('post', '/api/raids/run/:runId/up', (a, _b, req) => raids.up(a, str(req.params.runId)));
  route('post', '/api/raids/run/:runId/abandon', (a, _b, req) => raids.abandon(a, str(req.params.runId)));
  route('post', '/api/raids/run/:runId/fighter-killed', (a, b, req) => raids.fighterKilled(a, str(req.params.runId), str(b.fighterId)));
  route('post', '/api/raids/run/:runId/fighter-check', (a, b, req) => {
    const s = (b.situation ?? {}) as Record<string, unknown>;
    return raids.fighterCheck(a, str(req.params.runId), str(b.fighterId), {
      health: num(s.health), partyStanding: num(s.partyStanding), fightersDown: num(s.fightersDown), playersDown: num(s.playersDown),
      bossRoom: s.bossRoom === true, foesHealth: num(s.foesHealth),
    }, num(b.hp));
  });

  route('post', '/api/raids/salvage/sell', (a, b) => raids.sell(a, str(b.kind), num(b.qty)));
  route('post', '/api/raids/agents/tick', async () => ({ hall: await raids.tickHall(), salvage: await raids.tickSalvage() }));
}
