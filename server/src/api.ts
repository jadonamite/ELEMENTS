import express, { type Application, type Request, type Response } from 'express';
import { verifyToken } from './auth.js';
import { createOrGetAccount, createOrGetRising, getRising } from './db.js';
import { isAccountAllowed, isIpAllowed } from './rate-limit.js';

function extractToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    const candidate = authHeader.slice(7).trim();
    if (candidate) return candidate;
  }
  const bodyToken = req.body?.token ?? req.body?.authToken;
  if (typeof bodyToken === 'string' && bodyToken.trim()) {
    return bodyToken.trim();
  }
  return null;
}

function extractIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.ip || req.socket.remoteAddress || '127.0.0.1';
}

const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

// ALLOWED_ORIGINS is a comma-separated list; unset means local development only.
export function isOriginAllowed(origin: string, list = process.env.ALLOWED_ORIGINS): boolean {
  const allowed = (list ?? '').split(',').map((o) => o.trim()).filter(Boolean);
  if (allowed.length === 0) return LOCAL_ORIGIN.test(origin);
  return allowed.includes(origin);
}

export function setupApi(app: Application): void {
  app.use(express.json());

  app.use((req, res, next) => {
    const origin = req.headers.origin;
    res.setHeader('Vary', 'Origin');
    if (typeof origin === 'string' && isOriginAllowed(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  app.post('/api/session', async (req: Request, res: Response) => {
    const ip = extractIp(req);
    if (!isIpAllowed(ip)) {
      res.status(429).json({ error: 'Too many requests' });
      return;
    }

    const token = extractToken(req);
    if (!token) {
      res.status(401).json({ error: 'Missing auth token' });
      return;
    }

    let verified: { userId: string };
    try {
      verified = await verifyToken(token);
    } catch {
      res.status(401).json({ error: 'Invalid auth token' });
      return;
    }

    if (!isAccountAllowed(verified.userId)) {
      res.status(429).json({ error: 'Too many requests' });
      return;
    }

    createOrGetAccount(verified.userId);
    const stored = getRising(verified.userId);

    res.json({
      accountId: verified.userId,
      rising: stored
        ? {
            role: stored.role,
            element: stored.element ?? null,
          }
        : null,
    });
  });

  app.post('/api/rising', async (req: Request, res: Response) => {
    const ip = extractIp(req);
    if (!isIpAllowed(ip)) {
      res.status(429).json({ error: 'Too many requests' });
      return;
    }

    const token = extractToken(req);
    if (!token) {
      res.status(401).json({ error: 'Missing auth token' });
      return;
    }

    let verified: { userId: string };
    try {
      verified = await verifyToken(token);
    } catch {
      res.status(401).json({ error: 'Invalid auth token' });
      return;
    }

    if (!isAccountAllowed(verified.userId)) {
      res.status(429).json({ error: 'Too many requests' });
      return;
    }

    const rising = createOrGetRising(verified.userId);

    res.json({
      accountId: verified.userId,
      role: rising.role,
      element: rising.element ?? null,
      rising: {
        role: rising.role,
        element: rising.element ?? null,
      },
    });
  });
}
