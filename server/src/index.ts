import path from 'node:path';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { setupApi } from './api.js';
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
  server.define('zone', ZoneRoom);
  return { server, transport };
}

const { server, transport } = buildServer();

await server.listen(port, '127.0.0.1');
console.log(`ELEMENTS server listening on http://127.0.0.1:${port}`);

export { server, transport, port };
