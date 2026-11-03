import path from 'node:path';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { setupApi } from './api.js';
import { setTokenVerifier } from './auth.js';
import { startEconomyLoop } from './economy/index.js';
import { EmptyRoom } from './rooms/EmptyRoom.js';
import { ZoneRoom } from './rooms/ZoneRoom.js';

try {
  process.loadEnvFile(path.resolve(process.cwd(), '.env'));
} catch {
  try {
    process.loadEnvFile(path.resolve(process.cwd(), '../.env'));
  } catch {
    // Environment variables already populated
  }
}

// Local play without the login service: tokens of the form "dev:<name>" sign in as that name.
// Needs ELEMENTS_DEV_AUTH=1 and is never active in production.
if (process.env.ELEMENTS_DEV_AUTH === '1' && process.env.NODE_ENV !== 'production') {
  setTokenVerifier(async (token) => {
    if (!token.startsWith('dev:') || token.length < 5) throw new Error('Invalid auth token');
    return { userId: `dev_${token.slice(4)}` };
  });
  console.warn('Development sign-in is on: any "dev:<name>" token is accepted.');
}

const rawPort = process.env.PORT;
const port = rawPort ? parseInt(rawPort, 10) : 2567;

export function buildServer(): { server: Server; transport: WebSocketTransport } {
  const transport = new WebSocketTransport();
  const app = transport.getExpressApp();
  setupApi(app);

  const server = new Server({
    greet: false,
    transport,
  });
  server.define('empty', EmptyRoom);
  server.define('zone', ZoneRoom).filterBy(['zone']);
  return { server, transport };
}

const { server, transport } = buildServer();

await server.listen(port, '127.0.0.1');
startEconomyLoop();
console.log(`ELEMENTS server listening on http://127.0.0.1:${port}`);

export { server, transport, port };
