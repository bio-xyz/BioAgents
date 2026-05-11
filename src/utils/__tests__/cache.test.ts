import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import { SimpleCache } from "../cache";

describe("SimpleCache", () => {
  let cache: SimpleCache<string>;

  beforeEach(() => {
    cache = new SimpleCache();
  });

  test("set and get a value", () => {
    cache.set("key", "value");
    expect(cache.get("key")).toBe("value");
  });

  test("returns null for missing key", () => {
    expect(cache.get("missing")).toBeNull();
  });

  test("delete removes the key", () => {
    cache.set("key", "value");
    cache.delete("key");
    expect(cache.get("key")).toBeNull();
  });

  test("clear removes all keys", () => {
    cache.set("a", "1");
    cache.set("b", "2");
    cache.clear();
    expect(cache.get("a")).toBeNull();
    expect(cache.get("b")).toBeNull();
  });

  test("expired entries return null", () => {
    const now = Date.now();
    jest.setSystemTime(new Date(now));

    cache.set("key", "value", 100); // 100ms TTL
    expect(cache.get("key")).toBe("value");

    jest.setSystemTime(new Date(now + 101));
    expect(cache.get("key")).toBeNull();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });
});
