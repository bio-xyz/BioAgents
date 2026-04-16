import { describe, expect, test } from "bun:test";
import { getState, parseIncomingMessage } from "../handler";

type TestWs = {
  send: (data: string) => void;
  close: (code?: number, reason?: string) => void;
  readyState?: number;
};

function makeWs(): TestWs {
  return { close: () => undefined, send: () => undefined };
}

describe("parseIncomingMessage", () => {
  test("returns null for non-JSON strings", () => {
    expect(parseIncomingMessage("not json")).toBeNull();
  });

  test("returns null for JSON primitives", () => {
    expect(parseIncomingMessage("42")).toBeNull();
    expect(parseIncomingMessage("null")).toBeNull();
    expect(parseIncomingMessage('"string"')).toBeNull();
  });

  test("returns null when action is missing or wrong type", () => {
    expect(parseIncomingMessage(JSON.stringify({}))).toBeNull();
    expect(parseIncomingMessage(JSON.stringify({ action: 123 }))).toBeNull();
    expect(parseIncomingMessage(JSON.stringify({ action: true }))).toBeNull();
  });

  test("returns null for unknown action", () => {
    expect(parseIncomingMessage(JSON.stringify({ action: "unknown" }))).toBeNull();
  });

  test("accepts auth action with token", () => {
    const result = parseIncomingMessage(JSON.stringify({ action: "auth", token: "jwt-token" }));
    expect(result).toEqual({
      action: "auth",
      token: "jwt-token",
      userId: undefined,
    });
  });

  test("accepts auth action with userId (anonymous mode)", () => {
    const result = parseIncomingMessage(JSON.stringify({ action: "auth", userId: "user-1" }));
    expect(result).toEqual({
      action: "auth",
      token: undefined,
      userId: "user-1",
    });
  });

  test("drops non-string token/userId in auth action", () => {
    const result = parseIncomingMessage(
      JSON.stringify({ action: "auth", token: 123, userId: { id: 1 } })
    );
    expect(result).toEqual({
      action: "auth",
      token: undefined,
      userId: undefined,
    });
  });

  test("accepts subscribe and unsubscribe actions", () => {
    expect(
      parseIncomingMessage(JSON.stringify({ action: "subscribe", conversationId: "c-1" }))
    ).toEqual({ action: "subscribe", conversationId: "c-1" });
    expect(
      parseIncomingMessage(JSON.stringify({ action: "unsubscribe", conversationId: "c-2" }))
    ).toEqual({ action: "unsubscribe", conversationId: "c-2" });
  });

  test("drops non-string conversationId in subscribe", () => {
    const result = parseIncomingMessage(
      JSON.stringify({ action: "subscribe", conversationId: 123 })
    );
    expect(result).toEqual({ action: "subscribe", conversationId: undefined });
  });

  test("accepts ping action", () => {
    expect(parseIncomingMessage(JSON.stringify({ action: "ping" }))).toEqual({
      action: "ping",
    });
  });

  test("accepts already-parsed object input (not just strings)", () => {
    expect(parseIncomingMessage({ action: "ping" } as unknown as string)).toEqual({
      action: "ping",
    });
  });
});

describe("getState WeakMap isolation", () => {
  test("returns a fresh state for a new ws and initializes userId to null", () => {
    const ws = makeWs();
    const state = getState(ws);
    expect(state.userId).toBeNull();
    expect(state.subscriptions instanceof Set).toBe(true);
    expect(state.subscriptions.size).toBe(0);
  });

  test("returns the same state across repeated calls for same ws", () => {
    const ws = makeWs();
    const a = getState(ws);
    a.userId = "user-1";
    a.subscriptions.add("conv-1");
    const b = getState(ws);
    expect(b).toBe(a);
    expect(b.userId).toBe("user-1");
    expect(b.subscriptions.has("conv-1")).toBe(true);
  });

  test("isolates state between different ws instances", () => {
    const ws1 = makeWs();
    const ws2 = makeWs();
    getState(ws1).userId = "user-1";
    getState(ws2).userId = "user-2";
    expect(getState(ws1).userId).toBe("user-1");
    expect(getState(ws2).userId).toBe("user-2");
  });
});
