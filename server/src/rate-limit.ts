interface RateBucket {
  count: number;
  resetAt: number;
}

const ipBuckets = new Map<string, RateBucket>();
const accountBuckets = new Map<string, RateBucket>();

const DEFAULT_IP_LIMIT = 120; // 120 requests per minute
const DEFAULT_ACCOUNT_LIMIT = 60; // 60 requests per minute
const DEFAULT_WINDOW_MS = 60 * 1000;

function checkBucket(
  buckets: Map<string, RateBucket>,
  key: string,
  limit: number,
  windowMs: number,
): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now >= bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (bucket.count >= limit) {
    return false;
  }

  bucket.count++;
  return true;
}

export function isIpAllowed(
  ip: string,
  limit = DEFAULT_IP_LIMIT,
  windowMs = DEFAULT_WINDOW_MS,
): boolean {
  return checkBucket(ipBuckets, ip, limit, windowMs);
}

export function isAccountAllowed(
  accountId: string,
  limit = DEFAULT_ACCOUNT_LIMIT,
  windowMs = DEFAULT_WINDOW_MS,
): boolean {
  return checkBucket(accountBuckets, accountId, limit, windowMs);
}

export function resetRateLimits(): void {
  ipBuckets.clear();
  accountBuckets.clear();
}
