/**
 * Startup smoke test.
 *
 * The extension's hooks run long after the module loads, so a bundle succeeding
 * says nothing about whether they work. The 0.2.2 release shipped with `dirname`
 * used in `detectWing()` and not imported: `bun build` was clean, this suite was
 * green, the tools all worked — and every `session_start` threw before it could
 * load the wake-up context. Nothing reported it; the wake-up block simply never
 * arrived.
 *
 * So: register the extension against a stub pi, then run every hook it registered
 * and require that none throws. That is the cheapest check that would have caught
 * it, and it costs one file.
 *
 * The python plumbing is mocked — this is a test of the extension's own paths, not
 * of the palace.
 */

import { describe, expect, mock, test } from "bun:test";
import { fileURLToPath } from "node:url";

const palacePath = fileURLToPath(new URL("../palace.ts", import.meta.url));
mock.module(palacePath, () => ({
  errorText: (error: unknown) => (error instanceof Error ? error.message : String(error)),
  runBridge: async () => null,
  runHelper: async () => null,
  loadTaxonomy: async () => null,
  loadEntities: async () => null,
}));

type Handler = (event: any, ctx: any) => Promise<unknown>;

function harness() {
  const handlers = new Map<string, Handler[]>();
  const tools = new Map<string, any>();

  const pi: any = {
    on: (name: string, fn: Handler) => handlers.set(name, [...(handlers.get(name) ?? []), fn]),
    registerTool: (tool: any) => tools.set(tool.name, tool),
    registerCommand: () => undefined,
    appendEntry: () => undefined,
    exec: async () => ({ code: 1, stdout: "", stderr: "" }),
  };

  const ctx: any = {
    cwd: "/tmp/mempalace-smoke-test",
    signal: undefined,
    hasUI: false,
    ui: { setStatus: () => undefined, notify: () => undefined },
    sessionManager: {
      getSessionFile: () => "/tmp/mempalace-smoke-test/session.jsonl",
      getEntries: () => [],
      appendCustomMessageEntry: () => undefined,
    },
  };

  const events: Record<string, any> = {
    session_start: {},
    session_before_compact: {},
    session_compact: {},
    turn_end: {},
    tool_call: { toolName: "mempalace_search", toolCallId: "smoke", input: { query: "x" } },
    tool_result: { toolName: "mempalace_search", toolCallId: "smoke", input: { query: "x" }, content: [], isError: false },
  };

  return { pi, ctx, events, handlers, tools };
}

describe("extension startup", () => {
  test("registers its tools and hooks", async () => {
    const { pi, handlers, tools } = harness();
    const { default: extension } = await import("../index.ts");
    extension(pi);

    expect(tools.has("mempalace")).toBe(true);
    expect(tools.has("mempalace_manage")).toBe(true);

    // Two surfaces, not forty tools: recall is declared every request, manage is
    // deferred until a reflection session loads it.
    expect(tools.get("mempalace").exposure).toBeUndefined();
    expect(tools.get("mempalace_manage").exposure).toBe("deferred");
    // The guard's tool_call/tool_result hooks are gone: name resolution and
    // refusal are validation inside the tool now, not interception of tools we
    // could not edit. Only the session lifecycle hooks remain.
    for (const hook of ["session_start", "session_before_compact", "session_compact", "turn_end"]) {
      expect(handlers.has(hook)).toBe(true);
    }
    expect(handlers.has("tool_call")).toBe(false);
  });

  test("every hook runs without throwing", async () => {
    const { pi, ctx, events, handlers } = harness();
    const { default: extension } = await import("../index.ts");
    extension(pi);

    for (const [name, fns] of handlers) {
      for (const fn of fns) {
        // A hook that throws is reported to the user as "Extension error" and
        // silently skips whatever it was meant to do — the 0.2.2 wake-up bug.
        // Returning undefined is normal; throwing is not.
        let thrown: unknown;
        try {
          await fn(events[name] ?? {}, ctx);
        } catch (error) {
          thrown = error;
        }
        expect({ hook: name, thrown }).toEqual({ hook: name, thrown: undefined });
      }
    }
  });

  test("cwd-derived wing and wake-up path survive an unreachable palace", async () => {
    const { pi, ctx, handlers } = harness();
    const { default: extension } = await import("../index.ts");
    extension(pi);

    // pi.exec and the bridge both fail in this harness, which is exactly the
    // "palace unavailable" path: it must degrade, not throw.
    for (const fn of handlers.get("session_start") ?? []) {
      await expect(fn({}, ctx)).resolves.toBeUndefined();
    }
  });
});
