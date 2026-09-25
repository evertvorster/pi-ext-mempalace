import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { fileURLToPath } from "node:url";
import { dirname, join, parse } from "node:path";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { join as joinPath } from "node:path";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const here = dirname(fileURLToPath(import.meta.url));
const bridge = join(here, "scripts", "bridge.py");

// llamacpp PEG grammar bug: anyOf/const/enum schemas cause string values
// to be extracted with literal quote chars (issue #22240). Workaround:
// use plain Type.String with description listing valid values instead of
// Type.Literal unions. The execute() function validates the string value.
const memoryTypeSchema = Type.String({
  description: "Memory type: decision, preference, milestone, problem, emotional_context, project_fact, workflow, quote, or open_loop",
});

const confidenceSchema = Type.String({
  description: "Confidence: low, medium, or high",
});

// ── llama.cpp PEG grammar string-extraction workaround ──────────────────
// llama.cpp's PEG grammar parser (common/chat-parser.cpp) extracts string
// values from anyOf/const/enum schema branches with literal quote characters
// included. E.g., type "decision" arrives as '"decision"' (11 chars).
// This is a known, unconfirmed bug: https://github.com/ggml-org/llama.cpp/issues/22240
//
// Fix: strip surrounding quotes from enum-derived string values. If upstream
// fixes the bug, values arrive unquoted and this is a no-op.
function unquoteEnumValue(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  // Handle: '"decision"' or '"low"' (model-generated quotes with escaped inner quotes)
  // Also handle: '""decision""' (double-escaped, less common)
  let v = value;
  // Strip outermost pair of double-quotes if present
  if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) {
    v = v.slice(1, -1);
  }
  // Handle nested quoting (rare): '""decision""' -> '"decision"' -> 'decision'
  if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) {
    v = v.slice(1, -1);
  }
  return v;
}

function roomForType(type: string): string {
  const map: Record<string, string> = {
    decision: "decisions",
    preference: "preferences",
    milestone: "milestones",
    problem: "problems",
    emotional_context: "emotional-context",
    project_fact: "project-facts",
    workflow: "workflows",
    quote: "quotes",
    open_loop: "open-loops",
  };
  return map[type] ?? "memories";
}

function sanitizeWingName(value: string): string {
  return value
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    || "general";
}

function detectWing(cwd: string): string | undefined {
  let dir = cwd;
  while (true) {
    const config = join(dir, "mempalace.yaml");
    if (existsSync(config)) {
      const text = readFileSync(config, "utf8");
      const match = text.match(/^wing:\s*["']?([^"'\n#]+)["']?\s*$/m);
      if (match) return match[1].trim();
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

function defaultWing(cwd: string): string {
  return detectWing(cwd) ?? sanitizeWingName(parse(cwd).name);
}

const captureWingGuideline =
  "Captured transcripts and diary checkpoints follow the session's working directory — they are filed under the cwd-derived wing, not one shared wing. Project content belongs in the project wing; the pi wing is only for content about the pi coding agent itself.";

const scopedRetrievalGuideline =
  "Scope retrieval by default: the current project wing for project context, the user wing (evert) for user facts and preferences, and the agent wing (dora) for agent-private memory; avoid all-wing searches unless the question is genuinely cross-cutting.";

function compactJson(value: unknown, max = 12000): string {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return text.length > max ? `${text.slice(0, max)}\n\n[truncated to ${max} characters]` : text;
}

function renderSearch(data: any): string {
  const results = data?.results ?? [];
  if (!Array.isArray(results) || results.length === 0) return compactJson(data);
  return results.map((r: any, i: number) => {
    const sim = r.similarity === undefined ? "" : ` similarity=${r.similarity}`;
    const source = r.source_file ? ` source=${r.source_file}` : "";
    return `[${i + 1}] ${r.wing ?? "?"}/${r.room ?? "?"}${sim}${source}\n${r.text ?? r.content ?? ""}`;
  }).join("\n\n────────────────────────────────\n\n");
}

function formatMemory(params: any, source: string): string {
  const lines = [
    `type: ${params.type}`,
    `date: ${params.date ?? new Date().toISOString().slice(0, 10)}`,
    params.scope ? `scope: ${params.scope}` : undefined,
    `summary: ${params.summary}`,
    params.rationale ? `rationale: ${params.rationale}` : undefined,
    params.details ? `details: ${params.details}` : undefined,
    params.evidence ? `evidence: ${params.evidence}` : undefined,
    params.status ? `status: ${params.status}` : undefined,
    params.priority ? `priority: ${params.priority}` : undefined,
    params.category ? `category: ${params.category}` : undefined,
    params.nextAction ? `next_action: ${params.nextAction}` : undefined,
    params.blockedBy ? `blocked_by: ${params.blockedBy}` : undefined,
    params.owner ? `owner: ${params.owner}` : undefined,
    params.due ? `due: ${params.due}` : undefined,
    `source: ${source}`,
    `confidence: ${params.confidence ?? "medium"}`,
  ].filter(Boolean);
  return lines.join("\n");
}

export default function (pi: ExtensionAPI) {
  let lastCheckpointUserCount = 0;
  const checkpointInterval = 15;

  function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  async function runBridge(command: string, payload: Record<string, unknown> = {}, signal?: AbortSignal) {
    let stdout = "";
    let stderr = "";
    const outputFile = joinPath(tmpdir(), `pi-mempalace-${process.pid}-${randomUUID()}.json`);
    try {
      const result = await execFileAsync("/usr/bin/python", [bridge, command, JSON.stringify(payload)], {
        signal,
        timeout: 120000,
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env, MEMPALACE_BRIDGE_OUTPUT: outputFile },
      });
      stdout = result.stdout ?? "";
      stderr = result.stderr ?? "";
    } catch (error: any) {
      stdout = error?.stdout ?? "";
      stderr = error?.stderr ?? "";
      if (!existsSync(outputFile)) {
        throw new Error(`mempalace bridge failed (${command}, code=${error?.code ?? "unknown"}, killed=${error?.killed ?? false})\nstdout:\n${stdout}\nstderr:\n${stderr}\n${errorText(error)}`);
      }
    }

    const fileOutput = existsSync(outputFile) ? readFileSync(outputFile, "utf8") : "";
    rmSync(outputFile, { force: true });
    const jsonLine = (fileOutput || stdout).trim().split(/\r?\n/).filter(Boolean).at(-1);
    if (!jsonLine) {
      throw new Error(`mempalace bridge produced no JSON (${command})\nstdout:\n${stdout}\nstderr:\n${stderr}`);
    }
    let parsed: any;
    try {
      parsed = JSON.parse(jsonLine);
    } catch (error) {
      throw new Error(`mempalace bridge returned invalid JSON (${command}): ${errorText(error)}\nlast line:\n${jsonLine}\nstdout:\n${stdout}\nstderr:\n${stderr}`);
    }
    if (!parsed.ok) throw new Error(`${parsed.error ?? "mempalace bridge returned ok=false"}\n${parsed.details ?? ""}`);
    return parsed.data;
  }

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
      // Use appendCustomMessageEntry instead of pi.sendUserMessage to avoid
      // triggering the prompt() lifecycle (which sets activeRun = true and
      // prevents subagent dispatch). Custom message entries participate in
      // LLM context without starting an agent run.
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
    // Inject fresh wake-up context before compaction so it survives as a kept entry.
    // It appears among the surviving messages (at the end, since it's the last entry
    // before the compaction summary). This prevents personality drift after compaction.
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
      const result = await runBridge("hook_precompact", { transcript_path: transcriptPath, wing }, ctx.signal);
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
      const result = await runBridge("hook_checkpoint", { transcript_path: transcriptPath, session_id: ctx.sessionManager.getSessionFile() ?? "pi-session", wing }, ctx.signal);
      lastCheckpointUserCount = userCount;
      pi.appendEntry("mempalace-turn-checkpoint", { wing, userCount, result, timestamp: new Date().toISOString() });
      const count = result?.count ?? 0;
      ctx.ui.setStatus("mempalace-capture", `Memory: capture active (${count} checkpointed)`);
      if (count > 0) ctx.ui.notify(`MemPalace: checkpointed ${count} recent messages`, "success");
    } catch (error) {
      ctx.ui.setStatus("mempalace-capture", `Memory: checkpoint error (${errorText(error).split(/\r?\n/)[0]})`);
    }
  });

  pi.registerTool({
    name: "mempalace_status",
    label: "MemPalace Status",
    description: "Show local MemPalace palace status: total drawers, wings, rooms, and palace path.",
    promptSnippet: "Inspect local MemPalace long-term memory status and available wings/rooms.",
    promptGuidelines: [
      "Use mempalace_status before memory work when you need to know available wings or whether MemPalace is initialized.",
      "MemPalace is long-term semantic memory; pi session history remains the active short-term context.",
    ],
    parameters: Type.Object({}),
    async execute(_id, _params, signal) {
      const data = await runBridge("status", {}, signal);
      return { content: [{ type: "text", text: compactJson(data) }], details: data };
    },
  });

  pi.registerTool({
    name: "mempalace_search",
    label: "MemPalace Search",
    description: "Search local MemPalace memory. Returns verbatim drawers with similarity and source metadata.",
    promptSnippet: "Search long-term semantic memory for prior decisions, preferences, milestones, problems/fixes, workflows, quotes, or project context.",
    promptGuidelines: [
      "Use mempalace_search when the user asks about previous decisions, remembered preferences, prior sessions, project history, or semantic source-tree memory.",
      "Use exact code tools such as rg/read for precise code navigation; use mempalace_search for semantic recall and historical context.",
      "Do not inject MemPalace wake-up context automatically; search explicitly when relevant.",
      "NOTE: There are two tiers of memory. Structured memories (filed via mempalace_remember) live in rooms like decisions/, milestones/, problems/, workflows/. Auto-captured session transcripts live in {wing}/transcripts/ and are raw JSONL dumps — a safety net, not organized memories. Prefer searching structured rooms first.",
      captureWingGuideline,
      scopedRetrievalGuideline,
    ],
    parameters: Type.Object({
      query: Type.String({ description: "Search query" }),
      wing: Type.Optional(Type.String({ description: "Optional wing/project/person. Defaults to detected current project wing if defaultToCurrentWing is true." })),
      room: Type.Optional(Type.String({ description: "Optional room/topic filter" })),
      limit: Type.Optional(Type.Number({ description: "Max results, default 5", minimum: 1, maximum: 20 })),
      defaultToCurrentWing: Type.Optional(Type.Boolean({ description: "Use current project wing when wing is omitted. Default true." })),
    }),
    async execute(_id, params, signal, _onUpdate, ctx) {
      const wing = params.wing || (params.defaultToCurrentWing === false ? undefined : defaultWing(ctx.cwd));
      const data = await runBridge("search", { query: params.query, wing, room: params.room, limit: params.limit ?? 5 }, signal);
      return { content: [{ type: "text", text: renderSearch(data) }], details: data };
    },
  });

  pi.registerTool({
    name: "mempalace_remember",
    label: "MemPalace Remember",
    description: "File a high-quality structured memory into MemPalace as a drawer, after duplicate checking.",
    promptSnippet: "Save durable memories to MemPalace: decisions, preferences, milestones, problems/fixes, workflows, project facts, emotional context, or important quotes.",
    promptGuidelines: [
      "Use mempalace_remember only for durable, high-value memories: decisions, preferences, milestones, problems/fixes, workflows, project facts, open loops/TODOs, or important quotes.",
      "Use type=open_loop for pending follow-ups, deferred decisions, unresolved problems, and TODO-like items that should survive across sessions.",
      "IMPORTANT: This is the PRIMARY memory channel. Auto-captured session transcripts go into {wing}/transcripts/ automatically — you don't need to save conversation dumps here. Use this tool for structured, durable memories that will be useful in future sessions.",
      "Do not save random chatter, transient command output, secrets, credentials, or low-value intermediate reasoning.",
      "When saving, choose an appropriate wing and room. Project memories belong in the project wing; user preferences belong in a user/person wing; pi behavior/workflows can go in a pi wing.",
      captureWingGuideline,
      "For problem memories, include cause and fix/workaround when known.",
    ],
    parameters: Type.Object({
      type: memoryTypeSchema,
      summary: Type.String({ description: "Concise durable memory statement" }),
      wing: Type.Optional(Type.String({ description: "MemPalace wing. Defaults to detected current project wing." })),
      room: Type.Optional(Type.String({ description: "MemPalace room. Defaults from type: decisions/preferences/problems/etc." })),
      scope: Type.Optional(Type.String({ description: "Optional scope, project, feature, or topic" })),
      rationale: Type.Optional(Type.String({ description: "Why this matters or why the decision was made" })),
      details: Type.Optional(Type.String({ description: "Additional durable details" })),
      evidence: Type.Optional(Type.String({ description: "Short evidence or quote from the session" })),
      status: Type.Optional(Type.String({ description: "Status: open, in_progress, blocked, done, or dropped" })),
      priority: Type.Optional(Type.String({ description: "Priority: low, medium, high, or urgent" })),
      category: Type.Optional(Type.String({ description: "Optional open-loop category, e.g. bug, feature, research, cleanup, decision_needed, maintenance, documentation, packaging" })),
      nextAction: Type.Optional(Type.String({ description: "Concrete next action, especially for open_loop memories" })),
      blockedBy: Type.Optional(Type.String({ description: "Blocker, especially for open_loop memories" })),
      owner: Type.Optional(Type.String({ description: "Owner, e.g. evert, pi, assistant, unknown" })),
      due: Type.Optional(Type.String({ description: "Optional due date" })),
      source: Type.Optional(Type.String({ description: "Source label, default pi-session" })),
      confidence: Type.Optional(confidenceSchema),
      duplicateThreshold: Type.Optional(Type.Number({ description: "Similarity threshold for duplicate check, default 0.9", minimum: 0, maximum: 1 })),
      force: Type.Optional(Type.Boolean({ description: "Save even if duplicate check finds similar memory. Default false." })),
    }),
    async execute(_id, params, signal, _onUpdate, ctx) {
      // Workaround for llama.cpp PEG grammar double-quoting bug (issue #22240).
      // Strips literal quote characters from enum-derived string values.
      const validTypes = ["decision", "preference", "milestone", "problem", "emotional_context", "project_fact", "workflow", "quote", "open_loop"];
      const type = unquoteEnumValue(params.type);
      const status = unquoteEnumValue(params.status);
      const priority = unquoteEnumValue(params.priority);
      const confidence = unquoteEnumValue(params.confidence);

      if (type && !validTypes.includes(type)) {
        return { isError: true, content: [{ type: "text", text: `Invalid type: "${type}". Must be one of: ${validTypes.join(", ")}` }], details: { type, params } };
      }

      const wing = sanitizeWingName(params.wing || defaultWing(ctx.cwd));
      const room = params.room || roomForType(type);
      const source = params.source || `pi-session:${ctx.sessionManager.getSessionFile() ?? "ephemeral"}`;
      const content = formatMemory({ ...params, type, status, priority, confidence }, source);

      const dup = await runBridge("check_duplicate", { content, threshold: params.duplicateThreshold ?? 0.9 }, signal);
      if (!params.force && dup?.is_duplicate) {
        const dupMatches = (dup as Record<string, unknown>)?.matches;
        const existingId = Array.isArray(dupMatches) && dupMatches.length > 0
          ? (dupMatches[0] as Record<string, unknown>)?.id as string | undefined
          : undefined;
        return {
          isError: true,
          content: [{ type: "text", text: existingId
            ? `Similar memory already exists (drawer ID: ${existingId}). Use mempalace_update_drawer to modify it, or pass force=true to save a new copy anyway.`
            : `Similar memory already exists; not saved. Use force=true to save anyway.\n\n${compactJson(dup, 6000)}`
          }],
          details: { duplicate: dup, existing_drawer_id: existingId, content, wing, room },
        };
      }

      const saved = await runBridge("add_drawer", { wing, room, content, source_file: source, added_by: "pi" }, signal);
      const drawerId = (saved as Record<string, unknown>)?.drawer_id;
      pi.appendEntry("mempalace-memory-saved", { wing, room, type, summary: params.summary, source, saved, timestamp: new Date().toISOString() });
      return {
        content: [{ type: "text", text: `Saved MemPalace memory to ${wing}/${room}. Drawer ID: ${drawerId}\n\n${content}` }],
        details: { drawer_id: drawerId, saved, duplicateCheck: dup, content, wing, room },
      };
    },
  });

  pi.registerTool({
    name: "mempalace_check_duplicate",
    label: "MemPalace Duplicate Check",
    description: "Check whether content is already present or very similar in MemPalace.",
    parameters: Type.Object({
      content: Type.String(),
      threshold: Type.Optional(Type.Number({ minimum: 0, maximum: 1, description: "Default 0.9" })),
    }),
    async execute(_id, params, signal) {
      const data = await runBridge("check_duplicate", { content: params.content, threshold: params.threshold ?? 0.9 }, signal);
      return { content: [{ type: "text", text: compactJson(data) }], details: data };
    },
  });

  pi.registerTool({
    name: "mempalace_open_loops",
    label: "MemPalace Open Loops",
    description: "Search MemPalace open-loop/TODO memories for pending follow-ups, deferred decisions, and unresolved work.",
    promptSnippet: "Find pending open loops and TODO-like long-term memories in MemPalace.",
    promptGuidelines: [
      "Use mempalace_open_loops when the user asks what remains to do, what is pending, or what open loops exist for a project or pi itself.",
      "Project TODO.md files are operational task lists; MemPalace open_loop drawers are durable cross-session reminders with rationale and context.",
      captureWingGuideline,
      scopedRetrievalGuideline,
    ],
    parameters: Type.Object({
      wing: Type.Optional(Type.String({ description: "Optional wing/project/person. Defaults to detected current project wing if defaultToCurrentWing is true." })),
      query: Type.Optional(Type.String({ description: "Optional semantic query. Default finds open/pending items." })),
      status: Type.Optional(Type.String({ description: "Status filter: open, in_progress, blocked, done, dropped, or any (default: any)" })),
      limit: Type.Optional(Type.Number({ description: "Max results, default 10", minimum: 1, maximum: 50 })),
      defaultToCurrentWing: Type.Optional(Type.Boolean({ description: "Use current project wing when wing is omitted. Default true." }))
    }),
    async execute(_id, params, signal, _onUpdate, ctx) {
      // Workaround for llama.cpp PEG grammar double-quoting bug (issue #22240)
      const status = unquoteEnumValue(params.status);
      const wing = params.wing || (params.defaultToCurrentWing === false ? undefined : defaultWing(ctx.cwd));
      const status_filter = status && status !== "any" ? ` status: ${status}` : " status: open OR in_progress OR blocked";
      const query = params.query || `type: open_loop${status_filter} pending TODO follow-up next_action`;
      const data = await runBridge("search", { query, wing, room: "open-loops", limit: params.limit ?? 10 }, signal);
      return { content: [{ type: "text", text: renderSearch(data) }], details: data };
    },
  });

  pi.registerTool({
    name: "mempalace_mine_project",
    label: "MemPalace Mine Project",
    description: "Run mempalace mine for a project path. Defaults to dry-run and asks confirmation for real mining.",
    parameters: Type.Object({
      path: Type.Optional(Type.String({ description: "Path to mine. Defaults to current working directory." })),
      wing: Type.Optional(Type.String({ description: "Optional wing override" })),
      mode: Type.Optional(Type.String({ description: "Mine mode: projects (default) or convos" })),
      limit: Type.Optional(Type.Number({ minimum: 1, maximum: 10000 })),
      dryRun: Type.Optional(Type.Boolean({ description: "Default true" }))
    }),
    async execute(_id, params, signal, _onUpdate, ctx) {
      // Workaround for llama.cpp PEG grammar double-quoting bug (issue #22240)
      const mode = unquoteEnumValue(params.mode);
      const target = params.path || ctx.cwd;
      const dryRun = params.dryRun !== false;
      if (!dryRun && ctx.hasUI) {
        const ok = await ctx.ui.confirm("Mine into MemPalace?", `Run mempalace mine on ${target}? This can take time and writes to the palace.`);
        if (!ok) return { isError: true, content: [{ type: "text", text: "Cancelled." }] };
      }
      const args = ["mine", target];
      if (mode === "convos") args.push("--mode", "convos");
      if (params.wing) args.push("--wing", params.wing);
      if (params.limit) args.push("--limit", String(params.limit));
      if (dryRun) args.push("--dry-run");
      const result = await pi.exec("mempalace", args, { signal, timeout: 10 * 60 * 1000 });
      const text = `${result.stdout}${result.stderr ? `\nSTDERR:\n${result.stderr}` : ""}`;
      return { isError: result.code !== 0, content: [{ type: "text", text: compactJson(text, 20000) }], details: { code: result.code, args } };
    },
  });

  pi.registerTool({
    name: "mempalace_wake_up",
    label: "MemPalace Wake Up",
    description: "Return MemPalace L0/L1 wake-up context for the current project wing. Context is automatically loaded at session start via the memory skill.",
    promptSnippet: "Get explicit L0/L1 wake-up context from MemPalace. Context is auto-loaded at session start; use this tool to reload or retrieve it manually.",
    promptGuidelines: [
      "Use mempalace_wake_up when the user explicitly asks to load wake-up context, when a task clearly needs a compact overview, or when you don't see wake-up context at session start.",
      "Do not use this tool for routine lookups — mempalace_search handles those. Wake-up is for the broad L0/L1 primer.",
    ],
    parameters: Type.Object({
      wing: Type.Optional(Type.String({ description: "Optional wing. Defaults to detected current project wing if defaultToCurrentWing is true." })),
      defaultToCurrentWing: Type.Optional(Type.Boolean({ description: "Default true" })),
    }),
    async execute(_id, params, signal, _onUpdate, ctx) {
      const wing = params.wing || (params.defaultToCurrentWing === false ? undefined : defaultWing(ctx.cwd));
      const args = ["wake-up"];
      if (wing) args.push("--wing", wing);
      const result = await pi.exec("mempalace", args, { signal, timeout: 120000 });
      const text = `${result.stdout}${result.stderr ? `\nSTDERR:\n${result.stderr}` : ""}`;
      return { isError: result.code !== 0, content: [{ type: "text", text: compactJson(text, 16000) }], details: { code: result.code, wing } };
    },
  });

  // ─── Phase 2: Core CRUD + Knowledge Graph ──────────────────────────────

  pi.registerTool({
    name: "mempalace_diary_write",
    label: "MemPalace Diary Write",
    description: "Write a diary entry for this agent. Entries are timestamped and accumulate over time in a diary room.",
    promptSnippet: "Write to your personal agent diary in AAAK format. Your observations, thoughts, what you worked on, what matters.",
    parameters: Type.Object({
      agent_name: Type.String({ description: "Your agent name (e.g. 'pi')" }),
      entry: Type.String({ description: "Your diary entry text" }),
      topic: Type.Optional(Type.String({ description: "Topic tag (optional, default: general)" })),
      wing: Type.Optional(Type.String({ description: "Target wing for this entry (optional)" })),
    }),
    async execute(_id, params, signal) {
      const data = await runBridge("diary_write", { agent_name: params.agent_name, entry: params.entry, topic: params.topic, wing: params.wing }, signal);
      return { content: [{ type: "text", text: compactJson(data) }], details: data };
    },
  });

  pi.registerTool({
    name: "mempalace_diary_read",
    label: "MemPalace Diary Read",
    description: "Read recent diary entries. See your journal across sessions.",
    promptSnippet: "Read your recent diary entries. See what past versions of yourself recorded — your journal across sessions.",
    parameters: Type.Object({
      agent_name: Type.String({ description: "Your agent name (e.g. 'pi')" }),
      last_n: Type.Optional(Type.Number({ description: "Number of recent entries to read (default: 10)" })),
      wing: Type.Optional(Type.String({ description: "Wing to read from (optional)" })),
    }),
    async execute(_id, params, signal) {
      const data = await runBridge("diary_read", { agent_name: params.agent_name, last_n: params.last_n, wing: params.wing }, signal);
      return { content: [{ type: "text", text: compactJson(data) }], details: data };
    },
  });

  pi.registerTool({
    name: "mempalace_delete_drawer",
    label: "MemPalace Delete Drawer",
    description: "Delete a single drawer by ID. Irreversible.",
    promptSnippet: "Delete a MemPalace drawer by its ID. Use when a memory is bad, wrong, or no longer relevant.",
    parameters: Type.Object({
      drawer_id: Type.String({ description: "ID of the drawer to delete" }),
    }),
    async execute(_id, params, signal) {
      const data = await runBridge("delete_drawer", { drawer_id: params.drawer_id }, signal);
      return {
        content: [{ type: "text", text: `Deleted MemPalace drawer ${params.drawer_id}.` }],
        details: { drawer_id: params.drawer_id, ...data as Record<string, unknown> },
      };
    },
  });

  pi.registerTool({
    name: "mempalace_get_drawer",
    label: "MemPalace Get Drawer",
    description: "Fetch a single drawer by ID — returns full content and metadata.",
    promptSnippet: "Fetch a MemPalace drawer by its ID to see full content and metadata.",
    parameters: Type.Object({
      drawer_id: Type.String({ description: "ID of the drawer to fetch" }),
    }),
    async execute(_id, params, signal) {
      const data = await runBridge("get_drawer", { drawer_id: params.drawer_id }, signal);
      return {
        content: [{ type: "text", text: `Drawer ${params.drawer_id}: ${compactJson(data, 12000)}` }],
        details: { drawer_id: params.drawer_id, ...data as Record<string, unknown> },
      };
    },
  });

  pi.registerTool({
    name: "mempalace_list_drawers",
    label: "MemPalace List Drawers",
    description: "List drawers with pagination. Optional wing/room filter. Returns IDs, wings, rooms, and content previews.",
    promptSnippet: "List MemPalace drawers with pagination and optional wing/room filter. Returns drawer IDs, content previews.",
    parameters: Type.Object({
      wing: Type.Optional(Type.String({ description: "Filter by wing (optional)" })),
      room: Type.Optional(Type.String({ description: "Filter by room (optional)" })),
      limit: Type.Optional(Type.Number({ description: "Max results (default: 20)" })),
      offset: Type.Optional(Type.Number({ description: "Offset for pagination (default: 0)" })),
    }),
    async execute(_id, params, signal) {
      const data = await runBridge("list_drawers", { wing: params.wing, room: params.room, limit: params.limit, offset: params.offset }, signal);
      return { content: [{ type: "text", text: compactJson(data) }], details: data };
    },
  });

  pi.registerTool({
    name: "mempalace_update_drawer",
    label: "MemPalace Update Drawer",
    description: "Update an existing drawer's content and/or metadata (wing, room). Fetches existing drawer first.",
    promptSnippet: "Update an existing MemPalace drawer's content or wing/room. Use to correct mistakes without creating duplicates.",
    parameters: Type.Object({
      drawer_id: Type.String({ description: "ID of the drawer to update" }),
      content: Type.Optional(Type.String({ description: "New content (optional — omit to keep existing)" })),
      wing: Type.Optional(Type.String({ description: "New wing (optional — omit to keep existing)" })),
      room: Type.Optional(Type.String({ description: "New room (optional — omit to keep existing)" })),
    }),
    async execute(_id, params, signal) {
      const data = await runBridge("update_drawer", { drawer_id: params.drawer_id, content: params.content, wing: params.wing, room: params.room }, signal);
      const upd = data as Record<string, unknown>;
      const id = upd?.drawer_id ?? params.drawer_id;
      const w = upd?.wing ?? params.wing ?? "(unchanged)";
      const r = upd?.room ?? params.room ?? "(unchanged)";
      return {
        content: [{ type: "text", text: `Updated MemPalace drawer ${id} at ${w}/${r}.${compactJson(data, 6000)}` }],
        details: { drawer_id: id, ...data as Record<string, unknown> },
      };
    },
  });

  pi.registerTool({
    name: "mempalace_kg_invalidate",
    label: "MemPalace KG Invalidate",
    description: "Mark a knowledge graph fact as no longer true (set end date). Use when a relationship changed.",
    promptSnippet: "Invalidate a knowledge graph triple — mark a fact as ended. Used when facts change (protocol rule #5).",
    parameters: Type.Object({
      subject: Type.String({ description: "Entity (subject of the fact)" }),
      predicate: Type.String({ description: "Relationship type" }),
      object: Type.String({ description: "Object of the fact" }),
      ended: Type.Optional(Type.String({ description: "When it stopped being true (YYYY-MM-DD, default: today)" })),
    }),
    async execute(_id, params, signal) {
      const data = await runBridge("kg_invalidate", { subject: params.subject, predicate: params.predicate, object: params.object, ended: params.ended }, signal);
      return { content: [{ type: "text", text: compactJson(data) }], details: data };
    },
  });

  // ─── Phase 3: Browse + Discovery ──────────────────────────────────────

  pi.registerTool({
    name: "mempalace_list_wings",
    label: "MemPalace List Wings",
    description: "List all wings with drawer counts.",
    promptSnippet: "List all MemPalace wings with drawer counts to discover what's stored.",
    parameters: Type.Object({}),
    async execute(_id, _params, signal) {
      const data = await runBridge("list_wings", {}, signal);
      return { content: [{ type: "text", text: compactJson(data) }], details: data };
    },
  });

  pi.registerTool({
    name: "mempalace_list_rooms",
    label: "MemPalace List Rooms",
    description: "List rooms within a wing (or all rooms if no wing given).",
    promptSnippet: "List rooms within a MemPalace wing to navigate stored topics.",
    parameters: Type.Object({
      wing: Type.Optional(Type.String({ description: "Wing to list rooms for (optional)" })),
    }),
    async execute(_id, params, signal) {
      const data = await runBridge("list_rooms", { wing: params.wing }, signal);
      return { content: [{ type: "text", text: compactJson(data) }], details: data };
    },
  });

  pi.registerTool({
    name: "mempalace_get_taxonomy",
    label: "MemPalace Get Taxonomy",
    description: "Full taxonomy: wing → room → drawer count.",
    promptSnippet: "Get the full wing/room/drawer taxonomy tree for structural overview.",
    parameters: Type.Object({}),
    async execute(_id, _params, signal) {
      const data = await runBridge("get_taxonomy", {}, signal);
      return { content: [{ type: "text", text: compactJson(data) }], details: data };
    },
  });

  pi.registerTool({
    name: "mempalace_get_aaak_spec",
    label: "MemPalace Get AAAK Spec",
    description: "Get the AAAK dialect specification — the compressed memory format MemPalace uses.",
    promptSnippet: "Get the AAAK spec reference — the compressed memory format MemPalace uses.",
    parameters: Type.Object({}),
    async execute(_id, _params, signal) {
      const data = await runBridge("get_aaak_spec", {}, signal);
      return { content: [{ type: "text", text: compactJson(data) }], details: data };
    },
  });

  pi.registerTool({
    name: "mempalace_reconnect",
    label: "MemPalace Reconnect",
    description: "Force reconnect to the palace database. Use after external scripts or CLI commands modified the palace.",
    promptSnippet: "Reconnect MemPalace to the database after external modifications that may have stale in-memory state.",
    parameters: Type.Object({}),
    async execute(_id, _params, signal) {
      const data = await runBridge("reconnect", {}, signal);
      return { content: [{ type: "text", text: compactJson(data) }], details: data };
    },
  });

  pi.registerTool({
    name: "mempalace_memories_filed_away",
    label: "MemPalace Memories Filed Away",
    description: "Check whether the last checkpoint was saved. Returns message count and timestamp.",
    promptSnippet: "Check if a recent palace checkpoint was saved and see how many messages were archived.",
    parameters: Type.Object({}),
    async execute(_id, _params, signal) {
      const data = await runBridge("memories_filed_away", {}, signal);
      return { content: [{ type: "text", text: compactJson(data) }], details: data };
    },
  });

  // ─── Phase 4: Navigation + Graph Tools ────────────────────────────────

  pi.registerTool({
    name: "mempalace_traverse",
    label: "MemPalace Traverse",
    description: "Walk the palace graph from a room. Shows connected ideas across wings.",
    promptSnippet: "Traverse the MemPalace graph from a room — follow connections across wings to discover related ideas.",
    parameters: Type.Object({
      start_room: Type.String({ description: "Room to start from (e.g. 'chromadb-setup', 'riley-school')" }),
      max_hops: Type.Optional(Type.Number({ description: "How many connections to follow (default: 2)" })),
    }),
    async execute(_id, params, signal) {
      const data = await runBridge("traverse", { start_room: params.start_room, max_hops: params.max_hops }, signal);
      return { content: [{ type: "text", text: compactJson(data) }], details: data };
    },
  });

  pi.registerTool({
    name: "mempalace_find_tunnels",
    label: "MemPalace Find Tunnels",
    description: "Find rooms that bridge two wings — the hallways connecting different domains.",
    promptSnippet: "Find tunnels — rooms that appear in both wings, revealing cross-domain connections.",
    parameters: Type.Object({
      wing_a: Type.Optional(Type.String({ description: "First wing (optional)" })),
      wing_b: Type.Optional(Type.String({ description: "Second wing (optional)" })),
    }),
    async execute(_id, params, signal) {
      const data = await runBridge("find_tunnels", { wing_a: params.wing_a, wing_b: params.wing_b }, signal);
      return { content: [{ type: "text", text: compactJson(data) }], details: data };
    },
  });

  pi.registerTool({
    name: "mempalace_graph_stats",
    label: "MemPalace Graph Stats",
    description: "Palace graph overview: total rooms, tunnel connections, edges between wings.",
    promptSnippet: "Get palace graph statistics — rooms, tunnel connections, and connectivity between wings.",
    parameters: Type.Object({}),
    async execute(_id, _params, signal) {
      const data = await runBridge("graph_stats", {}, signal);
      return { content: [{ type: "text", text: compactJson(data) }], details: data };
    },
  });

  pi.registerTool({
    name: "mempalace_create_tunnel",
    label: "MemPalace Create Tunnel",
    description: "Create a cross-wing tunnel linking two palace locations. Use when content in one project relates to another.",
    promptSnippet: "Create an explicit cross-wing tunnel linking two palace locations — e.g., an API design connects to a database schema.",
    parameters: Type.Object({
      source_wing: Type.String({ description: "Wing of the source" }),
      source_room: Type.String({ description: "Room in the source wing" }),
      target_wing: Type.String({ description: "Wing of the target" }),
      target_room: Type.String({ description: "Room in the target wing" }),
      label: Type.Optional(Type.String({ description: "Description of the connection" })),
      source_drawer_id: Type.Optional(Type.String({ description: "Optional specific drawer ID" })),
      target_drawer_id: Type.Optional(Type.String({ description: "Optional specific drawer ID" })),
    }),
    async execute(_id, params, signal) {
      const data = await runBridge("create_tunnel", {
        source_wing: params.source_wing, source_room: params.source_room,
        target_wing: params.target_wing, target_room: params.target_room,
        label: params.label, source_drawer_id: params.source_drawer_id,
        target_drawer_id: params.target_drawer_id,
      }, signal);
      return { content: [{ type: "text", text: compactJson(data) }], details: data };
    },
  });

  pi.registerTool({
    name: "mempalace_list_tunnels",
    label: "MemPalace List Tunnels",
    description: "List all explicit cross-wing tunnels. Optionally filter by wing.",
    promptSnippet: "List all explicit MemPalace tunnels — cross-wing links created by the agent.",
    parameters: Type.Object({
      wing: Type.Optional(Type.String({ description: "Filter tunnels by wing (optional)" })),
    }),
    async execute(_id, params, signal) {
      const data = await runBridge("list_tunnels", { wing: params.wing }, signal);
      return { content: [{ type: "text", text: compactJson(data) }], details: data };
    },
  });

  pi.registerTool({
    name: "mempalace_delete_tunnel",
    label: "MemPalace Delete Tunnel",
    description: "Delete an explicit tunnel by its ID.",
    promptSnippet: "Delete a MemPalace tunnel by ID.",
    parameters: Type.Object({
      tunnel_id: Type.String({ description: "ID of the tunnel to delete" }),
    }),
    async execute(_id, params, signal) {
      const data = await runBridge("delete_tunnel", { tunnel_id: params.tunnel_id }, signal);
      return { content: [{ type: "text", text: compactJson(data) }], details: data };
    },
  });

  pi.registerTool({
    name: "mempalace_follow_tunnels",
    label: "MemPalace Follow Tunnels",
    description: "Follow tunnels from a room to see what it connects to in other wings. Returns connected rooms with drawer previews.",
    promptSnippet: "Follow tunnels from a room to discover connected ideas in other wings.",
    parameters: Type.Object({
      wing: Type.String({ description: "Wing to start from" }),
      room: Type.String({ description: "Room to follow tunnels from" }),
    }),
    async execute(_id, params, signal) {
      const data = await runBridge("follow_tunnels", { wing: params.wing, room: params.room }, signal);
      return { content: [{ type: "text", text: compactJson(data) }], details: data };
    },
  });

  // ─── Remaining bridge wrappers ────────────────────────────────────────

  pi.registerTool({
    name: "mempalace_add_drawer",
    label: "MemPalace Add Drawer",
    description: "File verbatim content into the palace. Checks for duplicates first. Unlike `remember`, this stores raw content without structured metadata.",
    promptSnippet: "File verbatim content directly into a MemPalace wing/room. Use for raw text storage (remember uses structured format).",
    parameters: Type.Object({
      wing: Type.String({ description: "Wing (project name)" }),
      room: Type.String({ description: "Room (aspect: backend, decisions, meetings...)" }),
      content: Type.String({ description: "Verbatim content to store — exact words, never summarized" }),
      source_file: Type.Optional(Type.String({ description: "Where this came from (optional)" })),
      added_by: Type.Optional(Type.String({ description: "Who is filing this (default: pi)" })),
    }),
    async execute(_id, params, signal) {
      const data = await runBridge("add_drawer", { wing: params.wing, room: params.room, content: params.content, source_file: params.source_file, added_by: params.added_by || "pi" }, signal);
      const added = data as Record<string, unknown>;
      const drawerId = added?.drawer_id ?? "(unknown)";
      return {
        content: [{ type: "text", text: `Filed verbatim drawer at ${params.wing}/${params.room}. Drawer ID: ${drawerId}` }],
        details: { drawer_id: drawerId, ...added },
      };
    },
  });

  pi.registerTool({
    name: "mempalace_kg_add",
    label: "MemPalace KG Add",
    description: "Add a fact to the knowledge graph. Subject → predicate → object with optional time window.",
    promptSnippet: "Add a knowledge graph triple — an entity relationship with optional validity window.",
    parameters: Type.Object({
      subject: Type.String({ description: "The entity doing/being something" }),
      predicate: Type.String({ description: "The relationship type (e.g. 'loves', 'works_on', 'daughter_of')" }),
      object: Type.String({ description: "The entity being connected to" }),
      valid_from: Type.Optional(Type.String({ description: "When this became true (YYYY-MM-DD, optional)" })),
      source_closet: Type.Optional(Type.String({ description: "Closet ID where this fact appears (optional)" })),
    }),
    async execute(_id, params, signal) {
      const data = await runBridge("kg_add", { subject: params.subject, predicate: params.predicate, object: params.object, valid_from: params.valid_from, source_closet: params.source_closet }, signal);
      return { content: [{ type: "text", text: compactJson(data) }], details: data };
    },
  });

  pi.registerTool({
    name: "mempalace_kg_query",
    label: "MemPalace KG Query",
    description: "Query the knowledge graph for an entity's relationships. Returns typed facts with temporal validity.",
    promptSnippet: "Query entity relationships in the knowledge graph — alternative to semantic search for structured facts.",
    parameters: Type.Object({
      entity: Type.String({ description: "Entity to query (e.g. 'Max', 'MyProject', 'Alice')" }),
      as_of: Type.Optional(Type.String({ description: "Date filter — only facts valid at this date (YYYY-MM-DD, optional)" })),
      direction: Type.Optional(Type.String({ description: "outgoing (entity→?), incoming (?→entity), or both (default: both)" })),
    }),
    async execute(_id, params, signal) {
      const data = await runBridge("kg_query", { entity: params.entity, as_of: params.as_of, direction: params.direction || "both" }, signal);
      return { content: [{ type: "text", text: compactJson(data) }], details: data };
    },
  });

  pi.registerTool({
    name: "mempalace_kg_timeline",
    label: "MemPalace KG Timeline",
    description: "Chronological timeline of facts. Shows the story of an entity (or everything) in order.",
    promptSnippet: "Get chronological timeline of knowledge graph facts — shows entity history.",
    parameters: Type.Object({
      entity: Type.Optional(Type.String({ description: "Entity to get timeline for (optional — omit for full timeline)" })),
    }),
    async execute(_id, params, signal) {
      const data = await runBridge("kg_timeline", { entity: params.entity || undefined }, signal);
      return { content: [{ type: "text", text: compactJson(data) }], details: data };
    },
  });

  pi.registerTool({
    name: "mempalace_kg_stats",
    label: "MemPalace KG Stats",
    description: "Knowledge graph overview: entities, triples, current vs expired facts, relationship types.",
    promptSnippet: "Get knowledge graph statistics — entity count, triple count, relationship types.",
    parameters: Type.Object({}),
    async execute(_id, _params, signal) {
      const data = await runBridge("kg_stats", {}, signal);
      return { content: [{ type: "text", text: compactJson(data) }], details: data };
    },
  });

  pi.registerTool({
    name: "mempalace_hook_settings",
    label: "MemPalace Hook Settings",
    description: "Get or set hook behavior. silent_save: True = save directly (no MCP clutter), False = legacy blocking. desktop_toast: True = show desktop notification. Call with no args to view.",
    promptSnippet: "Get or set MemPalace auto-save hook behavior — silent_save and desktop_toast settings.",
    parameters: Type.Object({
      silent_save: Type.Optional(Type.Boolean({ description: "True = silent direct save, False = blocking MCP calls" })),
      desktop_toast: Type.Optional(Type.Boolean({ description: "True = show desktop toast via notify-send" })),
    }),
    async execute(_id, params, signal) {
      const data = await runBridge("hook_settings", { silent_save: params.silent_save, desktop_toast: params.desktop_toast }, signal);
      return { content: [{ type: "text", text: compactJson(data) }], details: data };
    },
  });

  // ── Phase: Hallways — entity co-occurrence tools ──────────────────────

  pi.registerTool({
    name: "mempalace_list_hallways",
    label: "MemPalace List Hallways",
    description: "List auto-detected entity co-occurrence hallways within a wing. Hallways are connections between entities that appear together across drawers.",
    promptSnippet: "List hallways — entity co-occurrence connections discovered within MemPalace wings.",
    parameters: Type.Object({
      wing: Type.Optional(Type.String({ description: "Optional wing filter" })),
    }),
    async execute(_id, params, signal) {
      const data = await runBridge("list_hallways", { wing: params.wing }, signal);
      return { content: [{ type: "text", text: compactJson(data) }], details: data };
    },
  });

  pi.registerTool({
    name: "mempalace_delete_hallway",
    label: "MemPalace Delete Hallway",
    description: "Delete an auto-detected hallway by its ID.",
    promptSnippet: "Delete a MemPalace hallway by ID.",
    parameters: Type.Object({
      hallway_id: Type.String({ description: "ID of the hallway to delete" }),
    }),
    async execute(_id, params, signal) {
      const data = await runBridge("delete_hallway", { hallway_id: params.hallway_id }, signal);
      return { content: [{ type: "text", text: compactJson(data) }], details: data };
    },
  });

  // ── Phase: Bulk operations ────────────────────────────────────────────

  pi.registerTool({
    name: "mempalace_delete_by_source",
    label: "MemPalace Delete By Source",
    description: "Delete every drawer whose source_file metadata matches exactly. Defaults to dry-run reporting blast radius. Pass dry_run=false to commit (irreversible). Useful for cleaning up after contaminated imports or deleted transcript files.",
    promptSnippet: "Delete all drawers from a specific source file. Defaults to dry-run — use dry_run=false to commit.",
    parameters: Type.Object({
      source_file: Type.String({ description: "Source file path to match against drawer metadata" }),
      dry_run: Type.Optional(Type.Boolean({ description: "Default true — preview blast radius without deleting" })),
    }),
    async execute(_id, params, signal) {
      const data = await runBridge("delete_by_source", { source_file: params.source_file, dry_run: params.dry_run !== false }, signal);
      return { content: [{ type: "text", text: compactJson(data) }], details: data };
    },
  });

  pi.registerTool({
    name: "mempalace_sync",
    label: "MemPalace Sync",
    description: "Prune drawers whose source files are gitignored, missing, or moved. Defaults to dry-run. Pass apply=true to commit. Keeps the palace aligned with the filesystem.",
    promptSnippet: "Sync the palace with the filesystem — prune drawers from gitignored, missing, or moved source files.",
    parameters: Type.Object({
      project_dir: Type.Optional(Type.String({ description: "Project directory to sync (optional — all projects if omitted)" })),
      wing: Type.Optional(Type.String({ description: "Restrict to a specific wing" })),
      apply: Type.Optional(Type.Boolean({ description: "Default false (dry-run). Pass true to apply prunes irreversibly." })),
    }),
    async execute(_id, params, signal) {
      const data = await runBridge("sync", { project_dir: params.project_dir, wing: params.wing, apply: params.apply === true }, signal);
      return { content: [{ type: "text", text: compactJson(data) }], details: data };
    },
  });

  pi.registerCommand("mempalace-review", {
    description: "Ask the assistant to propose high-quality MemPalace memories from the current context",
    handler: async (_args, _ctx) => {
      pi.sendUserMessage(`Review the recent session for durable MemPalace memories. Do not save immediately unless the memories are clearly high-value and unambiguous.\n\nUse these MemPalace categories: decision, preference, milestone, problem, emotional_context, project_fact, workflow, quote.\n\nOnly propose memories that would remain useful in future sessions. Avoid random chatter, secrets, transient command output, and low-value implementation details.\n\nFor each candidate, show: type, wing, room, summary, rationale/details/evidence, confidence. Then ask me which to save. When I approve, call mempalace_remember for each approved memory.`);
    },
  });

  pi.registerCommand("mempalace-status", {
    description: "Show MemPalace status",
    handler: async (_args, ctx) => {
      try {
        const data = await runBridge("status", {}, ctx.signal);
        ctx.ui.notify(compactJson(data, 2000), "info");
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      }
    },
  });

  // ── Phase 7: Maintenance CLI commands ──────────────────────────────────

  pi.registerCommand("mempalace-repair", {
    description: "Repair MemPalace database (run mempalace repair)",
    handler: async (_args, _ctx) => {
      await pi.exec("mempalace", ["repair"]);
    },
  });

  pi.registerCommand("mempalace-compress", {
    description: "Compress MemPalace drawers (run mempalace compress)",
    handler: async (_args, _ctx) => {
      await pi.exec("mempalace", ["compress"]);
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
