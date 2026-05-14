import { describe, expect, test } from "bun:test";
import type { ConversationStateValues } from "../../../types/core";
import { createConversationStateWriteChain } from "../state";

describe("createConversationStateWriteChain", () => {
  test("serializes writes in enqueue order even with varied resolve delays", async () => {
    const order: string[] = [];
    const chain = createConversationStateWriteChain(async (id, values) => {
      const tag = (values as unknown as { tag: string }).tag;
      // First write resolves later than the second one would on its own,
      // so order must come from the chain — not from raw concurrency.
      if (tag === "first") {
        await new Promise((r) => setTimeout(r, 20));
      }
      order.push(`${id}:${tag}`);
    });

    const a = chain.write("cs-1", { tag: "first" } as unknown as ConversationStateValues);
    const b = chain.write("cs-1", { tag: "second" } as unknown as ConversationStateValues);
    await Promise.all([a, b]);

    expect(order).toEqual(["cs-1:first", "cs-1:second"]);
  });

  test("isolates write failures — later writes still run", async () => {
    const ok: string[] = [];
    const chain = createConversationStateWriteChain(async (_id, values) => {
      const tag = (values as unknown as { tag: string }).tag;
      if (tag === "bad") throw new Error("boom");
      ok.push(tag);
    });

    const failing = chain.write("cs-1", { tag: "bad" } as unknown as ConversationStateValues);
    const good = chain.write("cs-1", { tag: "good" } as unknown as ConversationStateValues);

    await expect(failing).rejects.toThrow("boom");
    await good;

    expect(ok).toEqual(["good"]);
  });

  test("flush waits for the entire queued tail", async () => {
    let resolved = 0;
    const chain = createConversationStateWriteChain(async () => {
      await new Promise((r) => setTimeout(r, 5));
      resolved++;
    });

    chain.write("cs-1", {} as ConversationStateValues);
    chain.write("cs-1", {} as ConversationStateValues);
    chain.write("cs-1", {} as ConversationStateValues);

    await chain.flush();
    expect(resolved).toBe(3);
  });
});
