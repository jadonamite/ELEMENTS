import { Packr } from 'msgpackr';

/**
 * A small client for the Colyseus room protocol: ask the matchmaker for a seat over
 * HTTP, open the room's WebSocket, then trade named messages packed as MessagePack.
 * It speaks only room messages (no synced state), which is all the zone room uses.
 */
const JOIN_ROOM = 10;
const ERROR = 11;
const ROOM_DATA = 13;
const LEAVE_ROOM = 12;
const packr = new Packr({ useRecords: false });
const encoder = new TextEncoder();
const decoder = new TextDecoder();

type Handler = (message: unknown) => void;

export interface Seat {
  sessionId: string;
  roomId: string;
  processId: string;
}

/** Test-only delay on every message in and out, seconds. */
export interface LinkOptions { delay?: number }

export class RoomLink {
  private readonly handlers = new Map<string, Handler[]>();
  private joined = false;
  private outbox: Array<Uint8Array<ArrayBuffer>> = [];
  onClose: ((code: number) => void) | null = null;

  private constructor(private readonly ws: WebSocket, readonly sessionId: string, private readonly opts: LinkOptions) {
    ws.binaryType = 'arraybuffer';
    ws.onmessage = (event) => this.later(() => this.receive(new Uint8Array(event.data as ArrayBuffer)));
    ws.onclose = (event) => this.onClose?.(event.code);
  }

  /** Finds or makes the room and joins it. `server` is the http(s) origin of the game server. */
  static async join(server: string, roomName: string, options: Record<string, unknown>, token: string | null, opts: LinkOptions = {}): Promise<RoomLink> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${server}/matchmake/joinOrCreate/${encodeURIComponent(roomName)}`, {
      method: 'POST', headers, body: JSON.stringify(options),
    });
    const seat = await res.json() as Seat & { error?: string };
    if (!res.ok || !seat.sessionId) throw new Error(seat.error ?? `Matchmaking failed (${res.status})`);
    const url = new URL(`/${seat.processId}/${seat.roomId}`, server.replace(/^http/, 'ws'));
    url.searchParams.set('sessionId', seat.sessionId);
    if (token) url.searchParams.set('_authToken', token);
    const ws = new WebSocket(url);
    const link = new RoomLink(ws, seat.sessionId, opts);
    await new Promise<void>((resolve, reject) => {
      link.on('__joined', () => resolve());
      link.on('__error', (m) => reject(new Error(String((m as { message?: string }).message ?? 'Join refused'))));
      ws.addEventListener('close', () => reject(new Error('The server closed the connection')), { once: true });
    });
    return link;
  }

  on(type: string, handler: Handler): void {
    const list = this.handlers.get(type) ?? [];
    list.push(handler);
    this.handlers.set(type, list);
  }

  send(type: string, message: unknown): void {
    const name = encoder.encode(type);
    const body = packr.pack(message);
    const frame = new Uint8Array(2 + name.length + body.length);
    frame[0] = ROOM_DATA;
    frame[1] = 0xa0 | name.length;
    frame.set(name, 2);
    frame.set(body, 2 + name.length);
    if (!this.joined) { this.outbox.push(frame); return; }
    this.later(() => { if (this.ws.readyState === WebSocket.OPEN) this.ws.send(frame); });
  }

  close(): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(new Uint8Array([LEAVE_ROOM]));
    this.ws.close();
  }

  private later(fn: () => void): void {
    const delay = this.opts.delay ?? 0;
    if (delay > 0) setTimeout(fn, delay * 1000);
    else fn();
  }

  private emit(type: string, message: unknown): void {
    for (const h of this.handlers.get(type) ?? []) h(message);
  }

  private receive(bytes: Uint8Array): void {
    const code = bytes[0]! & 0x1f;
    if (code === JOIN_ROOM) {
      // Acknowledge the handshake; the room then starts sending.
      this.ws.send(new Uint8Array([JOIN_ROOM]));
      this.joined = true;
      for (const frame of this.outbox) this.ws.send(frame);
      this.outbox = [];
      this.emit('__joined', null);
    } else if (code === ERROR) {
      this.emit('__error', { message: decoder.decode(bytes.subarray(3)) });
    } else if (code === ROOM_DATA) {
      let at = 1;
      const prefix = bytes[at++]!;
      let length: number;
      if ((prefix & 0xe0) === 0xa0) length = prefix & 0x1f;
      else if (prefix === 0xd9) length = bytes[at++]!;
      else return;
      const type = decoder.decode(bytes.subarray(at, at + length));
      at += length;
      const message = at < bytes.length ? packr.unpack(bytes.subarray(at)) : undefined;
      this.emit(type, message);
    }
  }
}
