/**
 * Command dispatch — one tool, thirty-six commands.
 *
 * Two kinds of command live here. Most are a thin mapping onto one `mempalace`
 * bridge command, so they are **data** (`PASSTHROUGH`): a command name, the bridge
 * command it calls, and a field rename. The twelve that need judgement — rendering,
 * duplicate checks, filters, name resolution — are code.
 *
 * Name resolution used to be a `tool_call` hook intercepting another extension's
 * tools. Inside the dispatcher it is just validation, in the same place as
 * everything else that can refuse a call.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { runBridge, runHelper, errorText, loadEntities, loadTaxonomy } from "./palace.ts";
import { isBoundaryInstant, resolveEntity, resolveIn, TYPE_ROOM, typeFromContent } from "./policy.ts";
import { renderKgQuery, renderListDrawers, renderSearch } from "./render.ts";
import { defaultWing, sanitizeWingName } from "./wing.ts";

export interface RunContext {
  cwd: string;
  sessionFile: string;
  hasUI: boolean;
}

export interface RunResult {
  text: string;
  details: unknown;
  isError?: boolean;
}

/** A hook that refuses the call, or notes what it changed. */
type Resolution = { note?: string; error?: string };

function compactJson(value: unknown, max = 12000): string {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return text.length > max ? `${text.slice(0, max)}\n\n[truncated to ${max} characters]` : text;
}

/** llama.cpp's PEG grammar returns enum-derived strings with literal quotes (issue #22240). */
function unquote(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  let v = String(value);
  while (v.startsWith('"') && v.endsWith('"') && v.length >= 2) v = v.slice(1, -1);
  return v;
}

// ── write-path name resolution ───────────────────────────────────────────
//
// The palace accumulated `project-facts` and `project_facts` in three wings and one
// person as three entities, because nothing refused any of it. An exact name passes,
// a mechanical variant is rewritten onto the populated spelling, a near-miss is
// refused with the correct name, and a genuinely new name is allowed but reported.

async function resolveWingName(wing: string): Promise<Resolution> {
  const taxonomy = await loadTaxonomy();
  if (!taxonomy) return {}; // palace unavailable: behave like a plain write
  const wings: Array<[string, number]> = Object.entries(taxonomy).map(([name, rooms]) => [
    name,
    Object.values(rooms).reduce((total, count) => total + count, 0),
  ]);
  const result = resolveIn(wing, wings, "Wing", "");
  if (result.kind === "blocked") return { error: result.message };
  if (result.kind === "new") return { note: `wing "${wing}" did not exist before this call and was created.` };
  if (result.rewritten) return { note: `wing "${wing}" resolved to "${result.rewritten}".` };
  return {};
}

async function resolveRoomName(wing: string, room: string): Promise<Resolution> {
  const taxonomy = await loadTaxonomy();
  if (!taxonomy) return {};
  const counts = new Map<string, number>();
  const own = taxonomy[wing];
  if (own) {
    for (const [name, count] of Object.entries(own)) counts.set(name, count);
  } else {
    for (const rooms of Object.values(taxonomy)) {
      for (const [name, count] of Object.entries(rooms)) counts.set(name, (counts.get(name) ?? 0) + count);
    }
  }
  const context = own ? ` in wing "${wing}"` : "";
  const result = resolveIn(room, [...counts.entries()], "Room", context);
  if (result.kind === "blocked") return { error: result.message };
  if (result.kind === "new") {
    return { note: `room "${room}" did not exist${context} and was created — if this is a typo, the content is now split.` };
  }
  if (result.rewritten) return { note: `room "${room}" resolved to "${result.rewritten}".` };
  return {};
}

async function resolveSubjectName(subject: string): Promise<Resolution> {
  const entities = await loadEntities();
  if (!entities) return {};
  const result = resolveEntity(subject, entities);
  if (result.kind === "blocked") return { error: result.message };
  if (result.kind === "new") return { note: `entity "${subject}" is new to the knowledge graph.` };
  if (result.rewritten) return { note: `entity "${subject}" resolved to "${result.rewritten}".` };
  return {};
}

function withNotes(text: string, notes: Resolution[]): string {
  const kept = notes.map((note) => note.note).filter(Boolean);
  return kept.length > 0 ? `${text}\n\n[guard] ${kept.join(" ")}` : text;
}

function refusal(notes: Resolution[]): string | undefined {
  return notes.find((note) => note.error)?.error;
}

// ── the drawer body ──────────────────────────────────────────────────────

function formatMemory(params: Record<string, any>, type: string, source: string): string {
  const lines = [
    `type: ${type}`,
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
    params.due ? `due: ${params.due}` : undefined,
    params.owner ? `owner: ${params.owner}` : undefined,
    source ? `source: ${source}` : undefined,
    params.confidence ? `confidence: ${params.confidence}` : undefined,
  ].filter(Boolean);
  return lines.join("\n");
}

// ── commands that are one bridge call with a field rename ────────────────

type Mapper = (p: Record<string, any>, ctx: RunContext) => Record<string, unknown>;

const PASSTHROUGH: Record<string, { bridge: string; map?: Mapper }> = {
  status: { bridge: "status" },
  check_duplicate: { bridge: "check_duplicate", map: (p) => ({ content: p.content, threshold: p.threshold ?? 0.9 }) },
  diary_write: { bridge: "diary_write", map: (p) => ({ agent_name: p.agentName, entry: p.entry, topic: p.topic, wing: p.wing }) },
  diary_read: { bridge: "diary_read", map: (p) => ({ agent_name: p.agentName, last_n: p.lastN, wing: p.wing }) },
  kg_add: { bridge: "kg_add", map: (p) => ({ subject: p.subject, predicate: p.predicate, object: p.object, valid_from: p.validFrom }) },
  kg_invalidate: { bridge: "kg_invalidate", map: (p) => ({ subject: p.subject, predicate: p.predicate, object: p.object, ended: p.at }) },
  kg_timeline: { bridge: "kg_timeline", map: (p) => ({ entity: p.entity }) },
  kg_stats: { bridge: "kg_stats" },
  taxonomy: { bridge: "get_taxonomy" },
  traverse: { bridge: "traverse", map: (p) => ({ start_room: p.startRoom, max_hops: p.maxHops }) },
  find_tunnels: { bridge: "find_tunnels", map: (p) => ({ wing_a: p.wingA, wing_b: p.wingB }) },
  follow_tunnels: { bridge: "follow_tunnels", map: (p) => ({ wing: p.wing, room: p.room }) },
  create_tunnel: {
    bridge: "create_tunnel",
    map: (p) => ({ source_wing: p.sourceWing, source_room: p.sourceRoom, target_wing: p.targetWing, target_room: p.targetRoom, label: p.label }),
  },
  list_tunnels: { bridge: "list_tunnels", map: (p) => ({ wing: p.wing }) },
  delete_tunnel: { bridge: "delete_tunnel", map: (p) => ({ tunnel_id: p.tunnelId }) },
  graph_stats: { bridge: "graph_stats" },
  sync: { bridge: "sync", map: (p) => ({ project_dir: p.projectDir, wing: p.wing, apply: p.apply === true }) },
  delete_by_source: { bridge: "delete_by_source", map: (p) => ({ source_file: p.sourceFile, dry_run: p.apply !== true }) },
  hook_settings: { bridge: "hook_settings", map: (p) => ({ silent_save: p.silentSave, desktop_toast: p.desktopToast }) },
  memories_filed_away: { bridge: "memories_filed_away" },
  reconnect: { bridge: "reconnect" },
};

/**
 * Commands that need code rather than a bridge passthrough. Listed explicitly so
 * that "table and dispatcher disagree" is a test failure instead of a throw when
 * someone finally calls the command.
 */
export const BESPOKE_COMMANDS = [
  "search", "ask", "open_loops", "get_drawer", "list_drawers",
  "remember", "fact", "add_drawer", "update_drawer", "delete_drawer",
  "kg_query", "orphans", "closets", "mine", "wake_up",
] as const;

export const HANDLED_COMMANDS: ReadonlySet<string> = new Set([
  ...Object.keys(PASSTHROUGH),
  ...BESPOKE_COMMANDS,
]);

// ── dispatch ─────────────────────────────────────────────────────────────

export async function runCommand(
  pi: ExtensionAPI,
  signal: AbortSignal | undefined,
  ctx: RunContext,
  command: string,
  params: Record<string, any>,
): Promise<RunResult> {
  const passthrough = PASSTHROUGH[command];
  if (passthrough) {
    const data = await runBridge(passthrough.bridge, passthrough.map ? passthrough.map(params, ctx) : {}, signal);
    return { text: compactJson(data), details: data };
  }

  switch (command) {
    // ── recall ───────────────────────────────────────────────────────────
    case "search": {
      const wing = params.wing || (params.allWings === true ? undefined : defaultWing(ctx.cwd));
      const data = await runBridge(
        "search",
        { query: params.query, wing, room: params.room, limit: params.limit ?? 5, min_similarity: params.minSimilarity },
        signal,
      );
      const rendered = await renderSearch(data, params.query, ctx.sessionFile);
      return { text: rendered ?? compactJson(data), details: data };
    }

    case "ask": {
      const data = await runHelper(
        "coverage.py",
        {
          query: params.query,
          min_similarity: params.minSimilarity,
          limit: params.limit,
          include_kg: params.includeKg !== false,
        },
        signal,
      );
      const scope = data?.scope ?? {};
      const lines = [
        `"${data.query}" — searched ${scope.drawers} drawers across ${scope.wings} wings / ${scope.rooms} rooms`,
        `hits above similarity ${data.threshold}: ${data.hit_count}`,
      ];
      for (const hit of data.knowledge_hits ?? []) {
        lines.push(`  ${String(hit.similarity).padEnd(5)} ${hit.wing}/${hit.room}  ${hit.drawer_id ?? ""}`);
      }
      if (data.archive_hits > 0) {
        lines.push(`  ${data.archive_hits} hit(s) in capture rooms (transcripts/diary) — event record, not knowledge`);
      }
      const kg = data.kg_facts ?? [];
      if (kg.length > 0) {
        lines.push(`knowledge graph: ${kg.map((f: any) => `${f.predicate} ${f.object}`).join("; ")}`);
      }
      if (data.verdict === "nothing") {
        const near = data.nearest_below_threshold;
        lines.push(
          `verdict: NOTHING STORED above ${data.threshold}` +
            (near ? ` — nearest ${near.similarity} in ${near.wing}/${near.room}` : ""),
        );
      } else if (data.verdict === "archive-only") {
        lines.push("verdict: archive only — we talked about it, but nothing was filed as knowledge");
      } else {
        lines.push("verdict: knowledge found");
      }
      return { text: lines.join("\n"), details: data };
    }

    case "open_loops": {
      const status = unquote(params.status);
      const wing = params.wing || (params.allWings === true ? undefined : defaultWing(ctx.cwd));
      const statusFilter = status && status !== "any" ? ` status: ${status}` : " status: open OR in_progress OR blocked";
      const query = params.query || `type: open_loop${statusFilter} pending TODO follow-up next_action`;
      const data = await runBridge("search", { query, wing, room: "open-loops", limit: params.limit ?? 10 }, signal);

      // The search is fuzzy and its query only *mentions* status, so it returns
      // finished work. A loop's own `status:` field is the truth.
      const allowed = status && status !== "any" ? new Set([status]) : new Set(["open", "in_progress", "blocked"]);
      const rows = Array.isArray(data?.results) ? data.results : [];
      let hidden = 0;
      const kept = rows.filter((row: any) => {
        const match = /(?:^|\n)status:\s*([a-z_]+)/i.exec(String(row?.text ?? ""));
        if (!match) return true;
        if (allowed.has(match[1].toLowerCase())) return true;
        hidden += 1;
        return false;
      });
      const rendered = await renderSearch({ ...data, results: kept }, query, ctx.sessionFile, { broaden: false });
      const note = hidden > 0 ? `\n[${hidden} finished loop${hidden === 1 ? "" : "s"} hidden — status not in ${[...allowed].join("/")}]` : "";
      return { text: `${rendered ?? compactJson(data)}${note}`, details: data };
    }

    case "get_drawer": {
      const data = await runBridge("get_drawer", { drawer_id: params.drawerId }, signal);
      return { text: `Drawer ${params.drawerId}: ${compactJson(data, 12000)}`, details: data };
    }

    case "list_drawers": {
      const data = await runBridge(
        "list_drawers",
        { wing: params.wing, room: params.room, limit: params.limit, offset: params.offset },
        signal,
      );
      return { text: renderListDrawers(data) ?? compactJson(data), details: data };
    }

    // ── write ────────────────────────────────────────────────────────────
    case "remember": {
      const types = Object.keys(TYPE_ROOM);
      const type = unquote(params.type) ?? "decision";
      if (!types.includes(type)) {
        return {
          isError: true,
          text: `Invalid type: "${type}". Must be one of: ${types.join(", ")}`,
          details: { type },
        };
      }
      const wing = sanitizeWingName(params.wing || defaultWing(ctx.cwd));
      const room = params.room || TYPE_ROOM[type];
      const notes: Resolution[] = [];
      if (params.wing) notes.push(await resolveWingName(wing));
      notes.push(await resolveRoomName(wing, room));
      const refused = refusal(notes);
      if (refused) return { isError: true, text: refused, details: { wing, room } };

      const source = params.source || `pi-session:${ctx.sessionFile || "ephemeral"}`;
      const content = formatMemory(
        { ...params, status: unquote(params.status), priority: unquote(params.priority), confidence: unquote(params.confidence) },
        type,
        source,
      );

      const dup = await runBridge("check_duplicate", { content, threshold: params.duplicateThreshold ?? 0.9 }, signal);
      if (!params.force && dup?.is_duplicate) {
        const existingId = Array.isArray(dup.matches) && dup.matches.length > 0 ? dup.matches[0]?.id : undefined;
        return {
          isError: true,
          text: existingId
            ? `Similar memory already exists (drawer ID: ${existingId}). Use mempalace_update_drawer to modify it, or pass force=true to save a new copy anyway.`
            : `Similar memory already exists; not saved. Use force=true to save anyway.\n\n${compactJson(dup, 6000)}`,
          details: { duplicate: dup, existing_drawer_id: existingId, content, wing, room },
        };
      }

      const saved = await runBridge(
        "add_drawer",
        { wing, room, content, source_file: source, added_by: "pi" },
        signal,
      );
      pi.appendEntry("mempalace-memory-saved", {
        wing,
        room,
        type,
        summary: params.summary,
        source,
        timestamp: new Date().toISOString(),
      });
      return {
        text: withNotes(`Saved MemPalace memory to ${wing}/${room}. Drawer ID: ${saved?.drawer_id}\n\n${content}`, notes),
        details: { drawer_id: saved?.drawer_id, saved, content, wing, room },
      };
    }

    case "fact": {
      const superseding = Boolean(params.oldObject);
      if (params.at !== undefined && !isBoundaryInstant(String(params.at))) {
        return {
          isError: true,
          text:
            `at="${params.at}" is not an accepted boundary instant. Use YYYY-MM-DD or YYYY-MM-DDTHH:MM:SSZ. ` +
            "Partial dates and local times are rejected because KG temporal values are compared as text, " +
            "and mixed formats silently return wrong query results.",
          details: { at: params.at },
        };
      }
      const notes: Resolution[] = [await resolveSubjectName(params.subject)];
      const refused = refusal(notes);
      if (refused) return { isError: true, text: refused, details: {} };

      if (superseding) {
        const data = await runHelper(
          "kg_supersede.py",
          { subject: params.subject, predicate: params.predicate, old_object: params.oldObject, new_object: params.object, at: params.at },
          signal,
        );
        const lines = [
          `Superseded: ${data?.fact ?? `${params.subject} → ${params.predicate} → ${params.object}`}`,
          `Previously: ${data?.superseded ?? params.oldObject}`,
          `Boundary: ${params.at ?? "now (UTC)"}`,
        ];
        if (data?.triple_id) lines.push(`Triple ID: ${data.triple_id}`);
        return { text: withNotes(lines.join("\n"), notes), details: data };
      }

      const data = await runHelper(
        "fact.py",
        {
          subject: params.subject,
          predicate: params.predicate,
          object: params.object,
          summary: params.summary,
          details: params.details,
          evidence: params.evidence,
          wing: params.wing,
          valid_from: params.validFrom,
          source: params.source,
        },
        signal,
      );
      pi.appendEntry("mempalace-fact", { ...data, timestamp: new Date().toISOString() });
      return {
        text: withNotes(
          `Fact filed: ${data.fact}\n  triple: ${data.triple_id}\n  drawer: ${data.drawer_id} (${data.room})`,
          notes,
        ),
        details: data,
      };
    }

    case "add_drawer": {
      const notes: Resolution[] = [await resolveWingName(params.wing), await resolveRoomName(params.wing, params.room)];
      const type = typeFromContent(String(params.content ?? ""));
      if (!type) {
        return {
          isError: true,
          text:
            "add_drawer needs a classification: put a `type:` header in the content " +
            `(${Object.keys(TYPE_ROOM).join(", ")}) or pass an explicit room. ` +
            "Writes with neither are how the 'general' room grew to 2,309 drawers.",
          details: {},
        };
      }
      const refused = refusal(notes);
      if (refused) return { isError: true, text: refused, details: {} };

      const data = await runBridge(
        "add_drawer",
        { wing: params.wing, room: params.room, content: params.content, source_file: params.sourceFile, added_by: "pi" },
        signal,
      );
      return {
        text: withNotes(`Filed verbatim drawer at ${params.wing}/${params.room}. Drawer ID: ${data?.drawer_id ?? "(unknown)"}`, notes),
        details: data,
      };
    }

    case "update_drawer": {
      const notes: Resolution[] = [];
      if (params.wing) notes.push(await resolveWingName(params.wing));
      if (params.room) notes.push(await resolveRoomName(params.wing ?? "", params.room));
      const refused = refusal(notes);
      if (refused) return { isError: true, text: refused, details: {} };

      const data = await runBridge(
        "update_drawer",
        { drawer_id: params.drawerId, content: params.content, wing: params.wing, room: params.room },
        signal,
      );
      const id = data?.drawer_id ?? params.drawerId;
      const w = data?.wing ?? params.wing ?? "(unchanged)";
      const r = data?.room ?? params.room ?? "(unchanged)";
      return { text: withNotes(`Updated MemPalace drawer ${id} at ${w}/${r}.`, notes), details: data };
    }

    case "delete_drawer": {
      const data = await runBridge("delete_drawer", { drawer_id: params.drawerId }, signal);
      return { text: `Deleted MemPalace drawer ${params.drawerId}.`, details: data };
    }

    // ── knowledge graph ──────────────────────────────────────────────────
    case "kg_query": {
      const data = await runBridge(
        "kg_query",
        { entity: params.entity, as_of: params.asOf, direction: params.direction || "both" },
        signal,
      );
      const facts = Array.isArray(data?.facts) ? data.facts : [];
      const matching = params.predicate ? facts.filter((f: any) => f.predicate === params.predicate) : facts;
      const current = matching.filter((f: any) => f.current !== false);
      const ended = matching.filter((f: any) => f.current === false);
      const capped = params.limit ? current.slice(0, params.limit) : current;
      const details = { ...data, facts: [...capped, ...ended] };
      const rendered = renderKgQuery(details, params.entity);
      if (!rendered) return { text: compactJson(data), details: data };
      const scope = params.predicate ? ` (predicate: ${params.predicate})` : "";
      const note =
        params.limit && current.length > capped.length
          ? `\n[${current.length - capped.length} more current fact${current.length - capped.length === 1 ? "" : "s"} not shown — raise limit, or filter with predicate]`
          : "";
      return {
        text: `${rendered.replace(/^"[^"]*"/, `"${params.entity}"${scope}`)}${note}`,
        details,
      };
    }

    // ── maintenance and admin ────────────────────────────────────────────
    case "orphans":
    case "closets": {
      const apply = params.apply === true;
      if (command === "closets") {
        const data = await runHelper("closets_rebuild.py", { wing: params.wing, limit: params.limit, apply }, signal);
        return {
          text: [
            `${data.wing}: ${data.drawers} drawers over ${data.sources} sources, ${data.room_groups} room groups`,
            apply ? `closets written: ${data.closets_written}` : "(dry run — pass apply=true to write)",
          ].join("\n"),
          details: data,
        };
      }

      const data = await runHelper(
        "orphans.py",
        { wing: params.wing, room: params.room, apply, limit: params.limit },
        signal,
      );
      const lines = [
        `sources scanned: ${data.scanned_sources}`,
        `orphaned sources: ${data.orphan_sources}  (${data.orphan_drawers} drawers)`,
      ];
      for (const row of Array.isArray(data.largest) ? data.largest : []) {
        lines.push(`  ${String(row.drawers).padStart(4)}  ${String(row.source).slice(-90)}`);
      }
      lines.push(apply ? `deleted: ${data.deleted_sources} sources / ${data.deleted_drawers} drawers` : "(dry run — pass apply=true to delete)");
      return { text: lines.join("\n"), details: data };
    }

    case "mine": {
      const target = params.path || ctx.cwd;
      const dryRun = params.apply !== true;
      if (!dryRun && ctx.hasUI) {
        const ok = await (pi as any).ui?.confirm?.("Mine into MemPalace?", `Run mempalace mine on ${target}? This can take time and writes to the palace.`);
        if (ok === false) return { isError: true, text: "Cancelled.", details: {} };
      }
      const args = ["mine", target];
      if (params.wing) args.push("--wing", params.wing);
      if (params.limit) args.push("--limit", String(params.limit));
      if (dryRun) args.push("--dry-run");
      const result = await pi.exec("mempalace", args, { signal, timeout: 10 * 60 * 1000 });
      const text = `${result.stdout}${result.stderr ? `\nSTDERR:\n${result.stderr}` : ""}`;
      return { text: compactJson(text, 20000), details: { code: result.code, args }, isError: result.code !== 0 };
    }

    case "wake_up": {
      const wing = params.wing || (params.allWings === true ? undefined : defaultWing(ctx.cwd));
      const args = ["wake-up"];
      if (wing) args.push("--wing", wing);
      const result = await pi.exec("mempalace", args, { signal, timeout: 120_000 });
      const text = `${result.stdout}${result.stderr ? `\nSTDERR:\n${result.stderr}` : ""}`;
      return { text: compactJson(text, 16000), details: { code: result.code, wing }, isError: result.code !== 0 };
    }

    default:
      throw new Error(`no handler for command "${command}" — commands.ts and dispatch.ts disagree`);
  }
}

export { errorText };
