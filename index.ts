/**
 * pi-ext-mempalace — MemPalace as pi's durable memory.
 *
 * One tool, `mempalace`, with 36 commands (see commands.ts), because forty tool
 * schemas cost ~7 000 tokens on every request and made a decision out of every
 * call. Whatever runs after load — the session hooks — is smoke-tested in
 * test/startup.test.ts, because a clean bundle says nothing about a handler.
 *
 * Where the pieces live:
 *   commands.ts  what exists, what it requires, how a call is validated
 *   dispatch.ts  the handlers
 *   policy.ts    pure rules (type→room, name matching, thresholds)
 *   render.ts    how results are shown
 *   palace.ts    all python plumbing
 *   wing.ts      cwd → wing resolution
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { COMMANDS, MANAGE_COMMANDS, PARAMS, RECALL_COMMANDS, paramsForSurface, validateCommand, type Surface } from "./commands.ts";
import { runCommand } from "./dispatch.ts";
import { errorText, runBridge } from "./palace.ts";
import { defaultWing } from "./wing.ts";

/** A surface's command list, as the one-line index its description can afford. */
function describeCommands(surface: Surface): string {
  const names = surface === "recall" ? RECALL_COMMANDS : MANAGE_COMMANDS;
  return names
    .map((name) => {
      const required = COMMANDS[name].required;
      return required.length > 0 ? `${name}(${required.join(", ")})` : name;
    })
    .join(" · ");
}

/** One schema per surface: only the parameters that surface's commands use. */
function surfaceSchema(surface: Surface) {
  const fields: Record<string, unknown> = {};
  for (const name of paramsForSurface(surface)) {
    const spec = PARAMS[name];
    const description = spec.note;
    const base =
      spec.kind === "number"
        ? Type.Number({ description })
        : spec.kind === "boolean"
          ? Type.Boolean({ description })
          : Type.String({ description });
    fields[name] = Type.Optional(base);
  }
  fields.command = Type.String({
    description: `one of: ${(surface === "recall" ? RECALL_COMMANDS : MANAGE_COMMANDS).join(", ")}`,
  });
  return Type.Object(fields as never);
}

const captureWingGuideline =
  "Captured transcripts and diary checkpoints follow the session's working directory — they are filed under the cwd-derived wing, not one shared wing. Project content belongs in the project wing; the pi wing is only for content about the pi coding agent itself.";

export default function (pi: ExtensionAPI) {
  let lastCheckpointUserCount = 0;
  const checkpointInterval = 15;

  async function generateWakeupContext(
    pi: ExtensionAPI,
    signal: AbortSignal | undefined,
    cwd: string,
    identityWing: string,
  ): Promise<string> {
    const projectWing = defaultWing(cwd);
    const wakeParts: string[] = [];

    async function doWake(wing: string, label?: string): Promise<void> {
      try {
        const result = await pi.exec("mempalace", ["wake-up", "--wing", wing], { signal, timeout: 120000 });
        const text = result.stdout?.trim() ?? "";
        if (text) {
          wakeParts.push(label ? `[${label} — ${wing}]\n${text}` : text);
        }
      } catch (_e) {
        // Best-effort; session continues without it.
      }
    }

    await doWake(identityWing);
    if (projectWing && projectWing !== identityWing) {
      await doWake(projectWing, "Project Context");
    }

    const joiner = "\n\n==================================================\n\n";
    return wakeParts.join(joiner);
  }

  pi.on("session_start", async (_event, ctx) => {
    const projectWing = defaultWing(ctx.cwd);
    ctx.ui.setStatus("mempalace-capture", `Memory: capture active (${projectWing}/transcripts)`);
    try {
      const status: any = await runBridge("status", {}, ctx.signal);
      const count = status?.wings?.[projectWing] ?? 0;
      ctx.ui.setStatus("mempalace", `MemPalace: ${projectWing} (${count})`);
    } catch (error) {
      ctx.ui.setStatus("mempalace", `MemPalace: ${projectWing} (unavailable: ${errorText(error).split(/\r?\n/)[0]})`);
    }

    const identityWing = "dora";
    const wakeText = await generateWakeupContext(pi, ctx.signal, ctx.cwd, identityWing);
    if (wakeText) {
      // appendCustomMessageEntry rather than sendUserMessage: a custom entry joins
      // the context without starting an agent run.
      try {
        ctx.sessionManager.appendCustomMessageEntry(
          "mempalace-wakeup",
          `[MemPalace Wake-Up Context — loaded at session start]\n${wakeText.trim()}`,
          false,
          { source: "mempalace-extension" },
        );
      } catch (_e) {
        // Best-effort; session continues without wake-up context.
      }
    }
  });

  pi.on("session_before_compact", async (_event, ctx) => {
    // Re-inject wake-up context before compaction so it survives as a kept entry.
    const identityWing = "dora";
    const wakeText = await generateWakeupContext(pi, ctx.signal, ctx.cwd, identityWing);
    if (wakeText) {
      ctx.sessionManager.appendCustomMessageEntry(
        "mempalace-wakeup",
        `[MemPalace Wake-Up Context — re-injected before compaction]\n${wakeText.trim()}`,
        true,
        { source: "mempalace-extension", reason: "pre-compaction" },
      );
    }

    const wing = defaultWing(ctx.cwd);
    const transcriptPath = ctx.sessionManager.getSessionFile() ?? "";
    ctx.ui.setStatus("mempalace-capture", "Memory: precompact ingest…");
    ctx.ui.notify("MemPalace: ingesting transcript before compaction", "info");

    try {
      await runBridge("hook_precompact", { transcript_path: transcriptPath, wing }, ctx.signal);
      ctx.ui.setStatus("mempalace-capture", "Memory: capture active (precompact saved)");
      ctx.ui.notify("MemPalace: transcript captured before compaction", "success");
    } catch (error) {
      ctx.ui.setStatus("mempalace-capture", `Memory: capture error (${errorText(error).split(/\r?\n/)[0]})`);
      ctx.ui.notify(`MemPalace precompact capture failed: ${errorText(error).split(/\r?\n/)[0]}`, "warning");
    }
  });

  pi.on("session_compact", async (event, ctx) => {
    ctx.ui.setStatus("mempalace-capture", "Memory: capture active (compacted)");
    ctx.ui.notify(`MemPalace: compaction completed (${event.fromExtension ? "extension" : "default"} summary)`, "info");
  });

  pi.on("turn_end", async (_event, ctx) => {
    const entries = ctx.sessionManager.getEntries() as any[];
    const userCount = entries.filter((entry) => {
      const text = Array.isArray(entry?.message?.content)
        ? entry.message.content.map((part: any) => part?.text ?? "").join("\n")
        : String(entry?.message?.content ?? "");
      return entry?.type === "message" && entry?.message?.role === "user" && !text.includes("<command-message>");
    }).length;

    if (userCount <= 0 || userCount - lastCheckpointUserCount < checkpointInterval) return;

    const wing = defaultWing(ctx.cwd);
    const transcriptPath = ctx.sessionManager.getSessionFile() ?? "";
    ctx.ui.setStatus("mempalace-capture", "Memory: checkpointing…");
    try {
      const result = await runBridge(
        "hook_checkpoint",
        { transcript_path: transcriptPath, session_id: ctx.sessionManager.getSessionFile() ?? "pi-session", wing },
        ctx.signal,
      );
      lastCheckpointUserCount = userCount;
      pi.appendEntry("mempalace-turn-checkpoint", { wing, userCount, result, timestamp: new Date().toISOString() });
      const count = result?.count ?? 0;
      ctx.ui.setStatus("mempalace-capture", `Memory: capture active (${count} checkpointed)`);
      if (count > 0) ctx.ui.notify(`MemPalace: checkpointed ${count} recent messages`, "success");
    } catch (error) {
      ctx.ui.setStatus("mempalace-capture", `Memory: checkpoint error (${errorText(error).split(/\r?\n/)[0]})`);
    }
  });

  /**
   * One execute path for both surfaces: validate against the table, refuse a
   * command that belongs to the other surface, then dispatch.
   */
  async function executeCommand(
    surface: Surface,
    command: string,
    given: Record<string, unknown>,
    ctx: any,
    signal: AbortSignal | undefined,
  ) {
    const name = command.trim();
    const spec = COMMANDS[name];
    if (spec && spec.surface !== surface) {
      const tool = spec.surface === "recall" ? "mempalace" : "mempalace_manage";
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text:
              `"${name}" is a ${spec.surface} command, carried by ${tool}. ` +
              (spec.surface === "manage" ? "Activate it with /mempalace, then retry." : "Call it on mempalace instead."),
          },
        ],
        details: { command: name, surface },
      };
    }

    const validated = validateCommand(name, given);
    if (!validated.ok) {
      return {
        isError: true,
        content: [{ type: "text" as const, text: validated.message }],
        details: { command: name, rejected: true },
      };
    }

    const payload: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(given)) {
      if (key !== "command" && value !== undefined) payload[key] = value;
    }

    try {
      const result = await runCommand(
        pi,
        signal,
        { cwd: ctx.cwd, sessionFile: ctx.sessionManager.getSessionFile() ?? "", hasUI: ctx.hasUI },
        name,
        payload,
      );
      return {
        isError: result.isError === true,
        content: [{ type: "text" as const, text: result.text }],
        details: result.details,
      };
    } catch (error) {
      const message = errorText(error);
      const hint = /currently recorded|no current/i.test(message)
        ? "\nThe refusal lists what is open — retry with one of those values."
        : /held by PID/i.test(message)
          ? "\nThe palace has a single writer. Retry once the other write finishes."
          : "";
      return {
        isError: true,
        content: [{ type: "text" as const, text: `mempalace ${name} failed: ${message}${hint}` }],
        details: { command: name, error: message },
      };
    }
  }

  pi.registerTool({
    name: "mempalace",
    label: "MemPalace",
    description:
      "pi's durable memory, read side: drawers grouped by wing (project, person or agent) and room " +
      `(topic). Commands: ${describeCommands("recall")}. Writing and organising live on mempalace_manage, ` +
      "which is loaded only for a reflection session — read the mempalace-memory skill before a command " +
      "whose parameters you are unsure of.",
    promptSnippet:
      "Recall from MemPalace: ask what is stored, search, list open loops, fetch a drawer. Always available and cheap.",
    promptGuidelines: [
      "Search before speaking when a person, project, decision or event is mentioned, and put the exact identifier in the query — an error string, a path, a tool name.",
      "Before saying 'I have nothing on that', command=ask: it reports the scope searched and the nearest miss, so absence is measured rather than assumed.",
      "A hit from transcripts/ or diary/ is an event record, not knowledge. Never treat it as a decision.",
      "Writing to memory is deliberate, not automatic: when something is worth filing, activate mempalace_manage with /mempalace rather than filing mid-thought.",
      captureWingGuideline,
    ],
    parameters: surfaceSchema("recall"),
    async execute(_id, params, signal, _onUpdate, ctx) {
      const given = params as Record<string, unknown>;
      return executeCommand("recall", String(given.command ?? ""), given, ctx, signal);
    },
  });

  // Deferred: registered and reachable by tool_search, but not declared to the
  // model and not costing a request until a reflection session activates it.
  pi.registerTool({
    name: "mempalace_manage",
    label: "MemPalace Manage",
    description:
      "pi's durable memory, write side: file facts and decisions, correct drawers, read and amend the " +
      `knowledge graph, re-room, sweep and maintain. Commands: ${describeCommands("manage")}. ` +
      "Loaded only for a reflection session — activate with /mempalace. Everything here changes the " +
      "palace, so read the mempalace-memory skill first, especially reflecting.md.",
    promptSnippet: "Write and organise MemPalace: facts, decisions, drawers, knowledge graph, maintenance.",
    promptGuidelines: [
      "command=remember files prose with rationale; command=fact files one checkable value as a triple and a drawer. Do not file conversation dumps.",
      "When a single-valued fact changes, pass oldObject to command=fact: the old value closes at one instant instead of leaving two current facts.",
      "Wings, rooms and entities are checked on every write: a mechanical variant is rewritten onto the populated spelling, a near-miss is refused with the correct name, a new name is allowed but reported. Retry with the name offered.",
      "Maintenance commands (orphans, closets, sync, delete_by_source, mine) are dry runs unless apply=true. Take a palace backup before a destructive pass.",
      "A drawer is a record, not evidence: verify against the code or the record before repeating a claim that came from memory.",
    ],
    exposure: "deferred",
    parameters: surfaceSchema("manage"),
    async execute(_id, params, signal, _onUpdate, ctx) {
      const given = params as Record<string, unknown>;
      return executeCommand("manage", String(given.command ?? ""), given, ctx, signal);
    },
  });

  // The loader: a tool that is deferred is reachable by tool_search but not
  // declared, so a reflection session opens with this.
  pi.registerCommand("mempalace", {
    description: "Activate MemPalace management for a reflection session (loads mempalace_manage)",
    handler: async (_args, ctx: any) => {
      const active = pi.getActiveTools();
      if (active.includes("mempalace_manage")) {
        ctx?.ui?.notify?.("MemPalace management is already active.", "info");
        return;
      }
      pi.setActiveTools([...active, "mempalace_manage"]);
      ctx?.ui?.notify?.("MemPalace management active — mempalace_manage is loaded for this session.", "success");
    },
  });

  pi.registerCommand("mempalace-repair", {
    description: "Rebuild the MemPalace vector index from SQLite metadata (run mempalace repair)",
    handler: async (_args, _ctx) => {
      await pi.exec("mempalace", ["repair"]);
    },
  });

  pi.registerCommand("mempalace-compress", {
    description: "Compress a wing's drawers with the AAAK dialect (run mempalace compress --wing)",
    handler: async (args, _ctx) => {
      const wing = args.trim();
      await pi.exec("mempalace", wing ? ["compress", "--wing", wing] : ["compress"]);
    },
  });

  pi.registerCommand("mempalace-split", {
    description: "Split large MemPalace drawers (run mempalace split)",
    handler: async (_args, _ctx) => {
      await pi.exec("mempalace", ["split"]);
    },
  });

  pi.registerCommand("mempalace-sweep", {
    description: "Sweep MemPalace for stale entries (run mempalace sweep)",
    handler: async (_args, _ctx) => {
      await pi.exec("mempalace", ["sweep"]);
    },
  });

  pi.registerCommand("mempalace-migrate", {
    description: "Migrate MemPalace schema (run mempalace migrate)",
    handler: async (_args, _ctx) => {
      await pi.exec("mempalace", ["migrate"]);
    },
  });
}
