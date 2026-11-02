import { describe, expect, test } from "bun:test";
import { COMMAND_NAMES, COMMANDS, PARAMS, validateCommand } from "../commands.ts";

describe("command table", () => {
  test("every command references parameters that exist", () => {
    const known = new Set(Object.keys(PARAMS));
    const unknown: string[] = [];
    for (const [name, spec] of Object.entries(COMMANDS)) {
      for (const param of [...spec.required, ...(spec.optional ?? [])]) {
        if (!known.has(param)) unknown.push(`${name}.${param}`);
      }
    }
    expect(unknown).toEqual([]);
  });

  test("no command lists the same parameter twice", () => {
    for (const [name, spec] of Object.entries(COMMANDS)) {
      const all = [...spec.required, ...(spec.optional ?? [])];
      expect({ name, dupes: all.length !== new Set(all).size }).toEqual({ name, dupes: false });
    }
  });

  test("the retired commands are gone", () => {
    for (const gone of ["get_aaak_spec", "list_wings", "list_rooms", "list_hallways", "delete_hallway"]) {
      expect(COMMAND_NAMES).not.toContain(gone);
    }
  });
});

describe("validateCommand", () => {
  test("passes a well-formed call", () => {
    expect(validateCommand("search", { query: "shader" })).toEqual({ ok: true });
  });

  test("names the missing parameters and what the command accepts", () => {
    const result = validateCommand("fact", { subject: "pi" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.message).toContain("needs parameters: predicate, object");
    expect(result.message).toContain("It accepts: subject, predicate, object");
  });

  test("refuses an unknown command and suggests near matches", () => {
    const result = validateCommand("serch", { query: "x" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.message).toContain('Unknown command "serch"');
    expect(result.message).toContain("search");
  });

  test("refuses a parameter the command would silently ignore", () => {
    const result = validateCommand("kg_stats", { limit: 5 });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.message).toContain("does not use parameter: limit");
    expect(result.message).toContain("silently ignored");
  });

  test("an empty string counts as missing", () => {
    const result = validateCommand("search", { query: "   " });
    expect(result.ok).toBe(false);
  });

  test("apply is accepted where the command writes, and refused where it does not", () => {
    expect(validateCommand("orphans", { apply: true })).toEqual({ ok: true });
    expect(validateCommand("search", { query: "x", apply: true }).ok).toBe(false);
  });
});

describe("table against dispatcher", () => {
  test("every command in the table has a handler", async () => {
    const { HANDLED_COMMANDS } = await import("../dispatch.ts");
    const missing = COMMAND_NAMES.filter((name) => !HANDLED_COMMANDS.has(name));
    expect(missing).toEqual([]);
  });

  test("no handler exists for a command that is not in the table", async () => {
    const { HANDLED_COMMANDS } = await import("../dispatch.ts");
    const known = new Set(COMMAND_NAMES);
    const orphans = [...HANDLED_COMMANDS].filter((name) => !known.has(name));
    expect(orphans).toEqual([]);
  });
});

describe("the mempalace tool", () => {
  test("refuses a call before dispatch when the command is unknown", async () => {
    const { default: extension } = await import("../index.ts");
    const tools = new Map<string, any>();
    extension({
      registerTool: (tool: any) => tools.set(tool.name, tool),
      registerCommand: () => undefined,
      on: () => undefined,
      appendEntry: () => undefined,
      exec: async () => ({ code: 0, stdout: "", stderr: "" }),
    } as any);

    const tool = tools.get("mempalace");
    const result = await tool.execute("id", { command: "serch", query: "x" }, undefined, undefined, {
      cwd: "/tmp",
      hasUI: false,
      sessionManager: { getSessionFile: () => "/tmp/s.jsonl" },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Unknown command "serch"');
  });
});

describe("surfaces", () => {
  test("every command belongs to exactly one surface", async () => {
    const { RECALL_COMMANDS, MANAGE_COMMANDS } = await import("../commands.ts");
    const all = [...RECALL_COMMANDS, ...MANAGE_COMMANDS];
    expect(all.length).toBe(COMMAND_NAMES.length);
    expect(new Set(all).size).toBe(COMMAND_NAMES.length);
  });

  test("recall stays small — it is declared on every request", async () => {
    const { RECALL_COMMANDS } = await import("../commands.ts");
    expect(RECALL_COMMANDS).toEqual(["search", "ask", "open_loops", "get_drawer", "list_drawers"]);
  });

  test("recall's schema is a fraction of manage's", async () => {
    const { paramsForSurface } = await import("../commands.ts");
    expect(paramsForSurface("recall").length).toBeLessThan(paramsForSurface("manage").length / 3);
  });
});

describe("crossing surfaces", () => {
  test("a manage command called through the recall tool is refused with the loader hint", async () => {
    const { default: extension } = await import("../index.ts");
    const tools = new Map<string, any>();
    extension({
      registerTool: (tool: any) => tools.set(tool.name, tool),
      registerCommand: () => undefined,
      on: () => undefined,
      appendEntry: () => undefined,
      getActiveTools: () => [],
      setActiveTools: () => undefined,
      exec: async () => ({ code: 0, stdout: "", stderr: "" }),
    } as any);

    const result = await tools.get("mempalace").execute(
      "id",
      { command: "remember", summary: "x" },
      undefined,
      undefined,
      { cwd: "/tmp", hasUI: false, sessionManager: { getSessionFile: () => "/tmp/s.jsonl" } },
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('"remember" is a manage command');
    expect(result.content[0].text).toContain("/mempalace");
  });
});
