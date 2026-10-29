import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { EmptyRoom } from './rooms/EmptyRoom.js';

const port = 2567;
const server = new Server({
  greet: false,
  transport: new WebSocketTransport(),
});
server.define('empty', EmptyRoom);

await server.listen(port, '127.0.0.1');
console.log(`ELEMENTS server listening on http://127.0.0.1:${port}`);
