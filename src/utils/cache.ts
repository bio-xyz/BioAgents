// lib/cache.ts
// We only export the class definition now. No instance is created here.
export class SimpleCache<T> {
  private cache = new Map<string, { value: T; expires: number }>();

  set(key: string, value: T, ttlMs = 300000) {
    // 5min default
    this.cache.set(key, { value, expires: Date.now() + ttlMs });
  }

  get(key: string): T | null {
    const item = this.cache.get(key);
    if (!item || Date.now() > item.expires) {
      if (item) this.cache.delete(key); // Clean up expired item
      return null;
    }
    return item.value;
  }

  delete(key: string) {
    this.cache.delete(key);
  }

  clear() {
    this.cache.clear();
  }
}
