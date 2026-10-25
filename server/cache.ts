export interface CacheEntry<T> {
  value: T;
  fetchedAt: number;
  expiresAt: number;
}

const MAX_ENTRIES = 500;
/** Même avec « force », on ne rappelle pas l'API pour une donnée plus récente que ça. */
const MIN_REFRESH_MS = 30_000;

/** Cache mémoire avec dédoublonnage des requêtes en cours et reprise sur copie périmée en cas d'erreur. */
export class Cache {
  private map = new Map<string, CacheEntry<unknown>>();
  private inflight = new Map<string, Promise<unknown>>();

  peek<T>(key: string): CacheEntry<T> | undefined {
    return this.map.get(key) as CacheEntry<T> | undefined;
  }

  set<T>(key: string, value: T, ttlMs: number): void {
    const now = Date.now();
    this.map.delete(key);
    this.map.set(key, { value, fetchedAt: now, expiresAt: now + ttlMs });
    if (this.map.size > MAX_ENTRIES) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
  }

  async remember<T>(
    key: string,
    ttlMs: number | (() => number),
    load: () => Promise<T>,
    force = false,
  ): Promise<{ value: T; fetchedAt: number; stale: boolean }> {
    const hit = this.peek<T>(key);
    const now = Date.now();
    const usable = hit && (force ? now - hit.fetchedAt < MIN_REFRESH_MS : now < hit.expiresAt);
    if (hit && usable) return { value: hit.value, fetchedAt: hit.fetchedAt, stale: false };

    let pending = this.inflight.get(key) as Promise<T> | undefined;
    if (!pending) {
      pending = load()
        .then((value) => {
          this.set(key, value, typeof ttlMs === 'function' ? ttlMs() : ttlMs);
          return value;
        })
        .finally(() => {
          this.inflight.delete(key);
        });
      this.inflight.set(key, pending);
    }

    try {
      const value = await pending;
      return { value, fetchedAt: this.peek<T>(key)?.fetchedAt ?? Date.now(), stale: false };
    } catch (err) {
      if (hit) return { value: hit.value, fetchedAt: hit.fetchedAt, stale: true };
      throw err;
    }
  }
}

/** Exécute les tâches une à la fois, dans l'ordre d'arrivée. */
export class Mutex {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    const next = this.tail.then(() => task());
    this.tail = next.catch(() => undefined);
    return next;
  }
}
