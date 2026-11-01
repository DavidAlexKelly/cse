/**
 * ontologyCache.ts
 *
 * A tiny in-memory + sessionStorage TTL cache designed for ontology loaders
 * that fetch large, mostly-static reference tables (canonical assets, unit
 * types, equipment types, relationship types, operations, hierarchy
 * templates, phase templates, …).
 *
 * Design goals:
 *   1. **Single-flight** — concurrent callers of the same key share ONE
 *      in-flight `Promise`, so the app never fires four parallel identical
 *      requests just because four components mounted at once.
 *   2. **TTL cache** — cached results are reused for up to `ttlMs`
 *      milliseconds. After that the next caller triggers a refresh, but
 *      still gets the stale value synchronously (stale-while-revalidate)
 *      when `swr` is enabled.
 *   3. **Cross-tab persistence** — small serialisable results are also
 *      mirrored to `sessionStorage` so a reload / tab switch inside the
 *      same session does not re-fetch. Large payloads (>1 MB) skip
 *      sessionStorage to avoid QuotaExceededError.
 *   4. **Cheap invalidation** — a single `invalidate(key)` clears both
 *      layers so mutation actions can force a refresh.
 *
 * Non-goals:
 *   - Cross-tab broadcast (BroadcastChannel) — out of scope.
 *   - IndexedDB — sessionStorage is enough for the sizes we deal with.
 */

// ── Types ────────────────────────────────────────────────────────────────

interface Entry<T> {
  value: T;
  loadedAt: number;
}

interface Pending<T> {
  promise: Promise<T>;
  startedAt: number;
}

export interface CachedLoadOptions {
  /** Time-to-live in ms. After this we consider the entry stale. Default 5 min. */
  ttlMs?: number;
  /**
   * If true, callers get the stale value synchronously while a background
   * refresh is running. Default: true. Set false when you MUST have a
   * fresh value (e.g. after a mutation the caller made itself).
   */
  swr?: boolean;
  /** If true, force a refetch even when a fresh entry exists. Default false. */
  force?: boolean;
  /**
   * Skip sessionStorage read/write for this key. Useful for very large
   * payloads or values we know change every session. Default: false.
   */
  skipSessionStorage?: boolean;
}

// ── State ────────────────────────────────────────────────────────────────

const _memory  = new Map<string, Entry<unknown>>();
const _pending = new Map<string, Pending<unknown>>();

const DEFAULT_TTL_MS = 5 * 60 * 1000;              // 5 minutes
const SESSION_PREFIX = "nxg-ontcache:v1:";          // bump on shape changes
const SESSION_MAX_BYTES = 1_000_000;                // 1 MB per key soft cap

// ── SessionStorage helpers (fail-safe) ───────────────────────────────────

function ssGet<T>(key: string): Entry<T> | null {
  try {
    const raw = sessionStorage.getItem(SESSION_PREFIX + key);
    if (!raw) return null;
    return JSON.parse(raw) as Entry<T>;
  } catch { return null; }
}

function ssSet<T>(key: string, entry: Entry<T>): void {
  try {
    const raw = JSON.stringify(entry);
    if (raw.length > SESSION_MAX_BYTES) return; // skip oversized payloads
    sessionStorage.setItem(SESSION_PREFIX + key, raw);
  } catch { /* quota / disabled — ignore */ }
}

function ssRemove(key: string): void {
  try { sessionStorage.removeItem(SESSION_PREFIX + key); } catch { /* ignore */ }
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Cache-wrapped loader. Returns the value from cache (memory → session →
 * fetch) with single-flight deduplication and optional stale-while-revalidate.
 *
 * @param key     Stable cache key. Use a namespace prefix (e.g. "ont:canonicalAssets").
 * @param loader  Async function that fetches a fresh value. Called at most once
 *                per in-flight window.
 * @param opts    See CachedLoadOptions.
 */
export async function cachedLoad<T>(
  key: string,
  loader: () => Promise<T>,
  opts: CachedLoadOptions = {},
): Promise<T> {
  const {
    ttlMs = DEFAULT_TTL_MS,
    swr = true,
    force = false,
    skipSessionStorage = false,
  } = opts;

  const now = Date.now();

  // ── 1. Force refresh short-circuit ─────────────────────────────────────
  if (force) {
    return await runAndStore(key, loader, skipSessionStorage);
  }

  // ── 2. In-memory cache ─────────────────────────────────────────────────
  const memHit = _memory.get(key) as Entry<T> | undefined;
  if (memHit) {
    const age = now - memHit.loadedAt;
    if (age < ttlMs) return memHit.value;           // fresh → return as-is
    if (swr) {
      // Stale-while-revalidate: kick off a background refresh, but return
      // the stale value NOW so callers don't block.
      void runAndStore(key, loader, skipSessionStorage).catch(() => { /* logged inside */ });
      return memHit.value;
    }
    // Stale + swr disabled → fall through to refetch (single-flight)
  }

  // ── 3. SessionStorage cache ────────────────────────────────────────────
  if (!skipSessionStorage) {
    const ssHit = ssGet<T>(key);
    if (ssHit) {
      _memory.set(key, ssHit as Entry<unknown>);
      const age = now - ssHit.loadedAt;
      if (age < ttlMs) return ssHit.value;
      if (swr) {
        void runAndStore(key, loader, skipSessionStorage).catch(() => { /* noop */ });
        return ssHit.value;
      }
    }
  }

  // ── 4. Single-flight fetch ─────────────────────────────────────────────
  return await runAndStore(key, loader, skipSessionStorage);
}

/**
 * Force a fresh fetch and cache the result. All concurrent callers share
 * the same underlying promise (single-flight).
 */
async function runAndStore<T>(
  key: string,
  loader: () => Promise<T>,
  skipSessionStorage: boolean,
): Promise<T> {
  const existing = _pending.get(key) as Pending<T> | undefined;
  if (existing) return existing.promise;

  const pending: Pending<T> = {
    startedAt: Date.now(),
    promise: (async () => {
      try {
        const value = await loader();
        const entry: Entry<T> = { value, loadedAt: Date.now() };
        _memory.set(key, entry as Entry<unknown>);
        if (!skipSessionStorage) ssSet(key, entry);
        return value;
      } catch (err) {
        // Don't cache errors — next caller retries.
        console.warn(`[ontologyCache] loader for "${key}" failed:`, err);
        throw err;
      } finally {
        _pending.delete(key);
      }
    })(),
  };

  _pending.set(key, pending as Pending<unknown>);
  return pending.promise;
}

/** Drop a single key from both cache layers. */
export function invalidate(key: string): void {
  _memory.delete(key);
  _pending.delete(key);
  ssRemove(key);
}

/**
 * Drop every cache entry whose key starts with the given prefix.
 * Useful when a mutation affects a whole family of loaders (e.g. all
 * "ont:templates:*" after saving a template).
 */
export function invalidatePrefix(prefix: string): void {
  for (const k of Array.from(_memory.keys())) {
    if (k.startsWith(prefix)) _memory.delete(k);
  }
  for (const k of Array.from(_pending.keys())) {
    if (k.startsWith(prefix)) _pending.delete(k);
  }
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const key = sessionStorage.key(i);
      if (key && key.startsWith(SESSION_PREFIX + prefix)) {
        sessionStorage.removeItem(key);
      }
    }
  } catch { /* ignore */ }
}

/** Nuke the entire cache. Useful for logout / auth changes. */
export function clearAll(): void {
  _memory.clear();
  _pending.clear();
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const key = sessionStorage.key(i);
      if (key && key.startsWith(SESSION_PREFIX)) sessionStorage.removeItem(key);
    }
  } catch { /* ignore */ }
}

/**
 * Test / debug helper — snapshot of what's currently cached in memory.
 * Not intended for production code.
 */
export function debugSnapshot(): Array<{ key: string; ageMs: number; sizeBytes: number }> {
  const now = Date.now();
  return Array.from(_memory.entries()).map(([key, e]) => {
    let sizeBytes = 0;
    try { sizeBytes = JSON.stringify(e.value).length; } catch { /* skip */ }
    return { key, ageMs: now - e.loadedAt, sizeBytes };
  });
}
