import path from 'node:path';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import type { Request, Response } from 'express';
import { setupApi } from '../api.js';
import { setTokenVerifier } from '../auth.js';
import { createDatabase, setDatabase } from '../db.js';
import { grantPlayerStartingPurse } from '../economy/ledgerService.js';
import { RaidRoom } from './RaidRoom.js';
import { setupRaidApi } from './api.js';
import { RaidService } from './service.js';
import { NearAiHallDecider } from './deciders.js';

/**
 * The raid lane's own server for trying raids before they are wired into the main one.
 * RAID_DEV_AUTH=1 accepts tokens of the form "dev:<name>" so two browser windows can be two players;
 * never set it anywhere real.
 */
const port = Number(process.env.RAID_PORT ?? 2670);
const db = createDatabase(process.env.RAID_DB ?? path.resolve(process.cwd(), 'raid-dev.sqlite'));
setDatabase(db);
const devAuth = process.env.RAID_DEV_AUTH === '1';
if (devAuth) {
  setTokenVerifier(async (t) => {
    if (!/^dev:[a-z0-9_-]{2,24}$/i.test(t)) throw new Error('bad dev token');
    return { userId: t.slice(4).toLowerCase() };
  });
}
const raids = new RaidService(db, { hallDecider: new NearAiHallDecider() });
const transport = new WebSocketTransport();
const app = transport.getExpressApp();
setupApi(app);
setupRaidApi(app, raids);
if (devAuth) {
  app.post('/api/raids/dev/grant', (req: Request, res: Response) => {
    const name = String(req.body?.name ?? '').toLowerCase();
    if (!/^[a-z0-9_-]{2,24}$/.test(name)) { res.status(400).json({ error: 'bad name' }); return; }
    grantPlayerStartingPurse(name, db);
    res.json({ ok: true, chroma: raids.balance(name) });
  });
}
const server = new Server({ greet: false, transport });
server.define('raid', RaidRoom, { raids }).filterBy(['runId']);
// The Hall and the salvage buyer think every half minute of real time.
setInterval(() => { void raids.tickHall(); void raids.tickSalvage(); }, 30_000);
await server.listen(port, '127.0.0.1');
console.log(`raid dev server on http://127.0.0.1:${port}${devAuth ? ' (dev tokens on)' : ''}`);
