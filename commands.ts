/**
 * The command table — one surface, 35 commands.
 *
 * pi sends a tool's schema on every request, so forty separate tools cost their
 * descriptions forty times over: ~9 900 characters before any parameter. The
 * count also made a decision out of every call ("get_taxonomy, or list_rooms?").
 * One tool with a `command` moves that decision into the skill, where it belongs,
 * and makes the parameters one shared vocabulary instead of sixty-eight names in
 * three conventions (`minSimilarity`, `valid_from`, `dry_run`/`apply`).
 *
 * This table is the source of truth for three things: what exists, what each
 * command requires, and how a call is validated before it runs. Rendering stays in
 * render.ts, rules in policy.ts, python in palace.ts.
 */

export type ParamKind = "string" | "number" | "boolean";

export interface ParamSpec {
  kind: ParamKind;
  /** Shown in the schema and in validation errors — one phrase, not a paragraph. */
  note: string;
  description?: string;
}

export type Surface = "recall" | "manage";

export interface CommandSpec {
  /** One line on what the command answers, used by the tool description. */
  summary: string;
  /**
   * Which tool carries it. `recall` is always declared — reading is what a
   * session does constantly. `manage` writes, restructures and maintains, and is
   * loaded only for a reflection session, so it costs nothing until then.
   */
  surface: Surface;
  required: readonly string[];
  optional?: readonly string[];
}

/**
 * The whole parameter vocabulary. Names are camelCase because the rest of this
 * codebase is, and because pi renders them into a JSON schema where a stray
 * underscore reads as a different world.
 */
export const PARAMS: Record<string, ParamSpec> = {
  command: { kind: "string", note: "which mempalace command to run (see the description)" },

  // scope
  wing: { kind: "string", note: "wing (project, person or agent); defaults to the current project" },
  room: { kind: "string", note: "room (topic) within the wing" },
  allWings: { kind: "boolean", note: "search every wing instead of the current project" },
  query: { kind: "string", note: "search text; exact identifiers score best" },
  limit: { kind: "number", note: "max results or facts" },
  offset: { kind: "number", note: "pagination offset" },
  minSimilarity: { kind: "number", note: "0-1 similarity floor; the only way to make search reject" },

  // drawer identity and body
  drawerId: { kind: "string", note: "drawer id, from a search hit or list" },
  content: { kind: "string", note: "verbatim text; add_drawer needs a `type:` header or an explicit room" },
  sourceFile: { kind: "string", note: "absolute path or provenance label for the content" },
  threshold: { kind: "number", note: "duplicate similarity threshold, default 0.9" },

  // typed memory (remember)
  type: { kind: "string", note: "memory class: decision, preference, milestone, problem, emotional_context, project_fact, workflow, quote, open_loop, reference" },
  summary: { kind: "string", note: "one-line statement of the memory" },
  scope: { kind: "string", note: "project, feature or topic the memory is about" },
  rationale: { kind: "string", note: "why it matters, or why the decision was made" },
  details: { kind: "string", note: "longer explanation" },
  evidence: { kind: "string", note: "the quote, command output or file that proves it" },
  status: { kind: "string", note: "open, in_progress, blocked, done, dropped — or a filter value" },
  priority: { kind: "string", note: "low, medium, high, urgent" },
  category: { kind: "string", note: "bug, feature, research, cleanup, decision_needed, maintenance, documentation, packaging" },
  nextAction: { kind: "string", note: "concrete next step for an open loop" },
  blockedBy: { kind: "string", note: "what is in the way" },
  owner: { kind: "string", note: "evert, pi, assistant, unknown" },
  due: { kind: "string", note: "date, usually for an open loop" },
  source: { kind: "string", note: "provenance label, default pi-session:…" },
  confidence: { kind: "string", note: "low, medium, high" },
  force: { kind: "boolean", note: "save despite a duplicate match" },
  duplicateThreshold: { kind: "number", note: "similarity above which remember refuses, default 0.9" },

  // knowledge graph
  entity: { kind: "string", note: "entity to query, e.g. 'Evert Vorster', 'SpaceSim'" },
  subject: { kind: "string", note: "entity the fact is about" },
  predicate: { kind: "string", note: "relationship from the closed vocabulary (is_a, uses, uses_model, located_in, maintains, …)" },
  object: { kind: "string", note: "the value or target of the relationship" },
  oldObject: { kind: "string", note: "value being replaced; passing it makes mempalace_fact a supersede" },
  at: { kind: "string", note: "boundary instant YYYY-MM-DD or YYYY-MM-DDTHH:MM:SSZ; also ends a fact" },
  validFrom: { kind: "string", note: "when the fact became true" },
  asOf: { kind: "string", note: "only facts valid at this date" },
  direction: { kind: "string", note: "outgoing, incoming, or both (default)" },

  // diary
  agentName: { kind: "string", note: "which agent's diary" },
  entry: { kind: "string", note: "diary text" },
  topic: { kind: "string", note: "diary topic tag" },
  lastN: { kind: "number", note: "how many diary entries to read" },

  // graph navigation
  startRoom: { kind: "string", note: "room to walk from" },
  maxHops: { kind: "number", note: "how many connections to follow, default 2" },
  wingA: { kind: "string", note: "first wing for find_tunnels" },
  wingB: { kind: "string", note: "second wing for find_tunnels" },
  tunnelId: { kind: "string", note: "explicit tunnel id" },
  sourceWing: { kind: "string", note: "tunnel source wing" },
  sourceRoom: { kind: "string", note: "tunnel source room" },
  targetWing: { kind: "string", note: "tunnel target wing" },
  targetRoom: { kind: "string", note: "tunnel target room" },
  label: { kind: "string", note: "description of what the tunnel connects" },

  // maintenance and admin
  apply: { kind: "boolean", note: "actually write; without it every maintenance command is a dry run" },
  path: { kind: "string", note: "project directory to mine; defaults to the cwd" },
  projectDir: { kind: "string", note: "project directory to sync; omit for all projects" },
  includeKg: { kind: "boolean", note: "also answer from the knowledge graph, default true" },
  silentSave: { kind: "boolean", note: "save without prompting" },
  desktopToast: { kind: "boolean", note: "show a desktop notification on save" },
};

export const COMMANDS: Record<string, CommandSpec> = {
  // ── recall: always declared, reading is what a session does ────────────
  search: { surface: "recall", summary: "ranked drawer hits, deduped, with preview and source", required: ["query"], optional: ["wing", "room", "limit", "minSimilarity", "allWings"] },
  ask: { surface: "recall", summary: "what do I have on this, with evidence for the absence case", required: ["query"], optional: ["minSimilarity", "limit", "includeKg"] },
  open_loops: { surface: "recall", summary: "pending work, filtered on each drawer's own status", required: [], optional: ["wing", "query", "status", "limit", "allWings"] },
  get_drawer: { surface: "recall", summary: "the full text of one drawer", required: ["drawerId"] },
  list_drawers: { surface: "recall", summary: "paginated drawers with provenance", required: [], optional: ["wing", "room", "limit", "offset"] },

  // ── manage: writes and structure, loaded for a reflection session ──────
  check_duplicate: { surface: "manage", summary: "is this text already stored", required: ["content"], optional: ["threshold"] },
  remember: {
    surface: "manage",
    summary: "file a typed memory: decision, problem, preference, open loop",
    required: ["summary"],
    optional: ["type", "wing", "room", "scope", "rationale", "details", "evidence", "status", "priority", "category", "nextAction", "blockedBy", "owner", "due", "source", "confidence", "duplicateThreshold", "force"],
  },
  fact: {
    surface: "manage",
    summary: "one checkable fact as a triple plus a drawer; oldObject makes it a supersede",
    required: ["subject", "predicate", "object"],
    optional: ["summary", "oldObject", "at", "details", "evidence", "wing", "validFrom", "source"],
  },
  add_drawer: { surface: "manage", summary: "verbatim text, classified", required: ["wing", "room", "content"], optional: ["sourceFile"] },
  update_drawer: { surface: "manage", summary: "rewrite a drawer in place, optionally moving it", required: ["drawerId"], optional: ["content", "wing", "room"] },
  delete_drawer: { surface: "manage", summary: "delete a drawer — irreversible, no dry run", required: ["drawerId"] },
  diary_write: { surface: "manage", summary: "narrative entry in the agent's diary", required: ["agentName", "entry"], optional: ["topic", "wing"] },
  diary_read: { surface: "manage", summary: "read recent diary entries", required: ["agentName"], optional: ["lastN", "wing"] },
  kg_query: { surface: "manage", summary: "an entity's typed facts, grouped, current by default", required: ["entity"], optional: ["predicate", "limit", "asOf", "direction"] },
  kg_add: { surface: "manage", summary: "add an independent fact with no drawer", required: ["subject", "predicate", "object"], optional: ["validFrom"] },
  kg_invalidate: { surface: "manage", summary: "end a fact; pass an instant, not a date, to end it now", required: ["subject", "predicate", "object"], optional: ["at"] },
  kg_timeline: { surface: "manage", summary: "an entity's facts in chronological order", required: [], optional: ["entity"] },
  kg_stats: { surface: "manage", summary: "entity, triple and predicate counts", required: [] },
  taxonomy: { surface: "manage", summary: "wing → room → drawer count; the map of what exists", required: [], optional: ["wing"] },
  traverse: { surface: "manage", summary: "walk the room graph from one room", required: ["startRoom"], optional: ["maxHops"] },
  find_tunnels: { surface: "manage", summary: "rooms bridging two wings", required: [], optional: ["wingA", "wingB"] },
  follow_tunnels: { surface: "manage", summary: "where one room connects in other wings", required: ["wing", "room"] },
  create_tunnel: { surface: "manage", summary: "link two rooms across wings explicitly", required: ["sourceWing", "sourceRoom", "targetWing", "targetRoom"], optional: ["label"] },
  list_tunnels: { surface: "manage", summary: "explicit cross-wing tunnels", required: [], optional: ["wing"] },
  delete_tunnel: { surface: "manage", summary: "remove an explicit tunnel", required: ["tunnelId"] },
  graph_stats: { surface: "manage", summary: "rooms, room instances and edges per wing", required: [] },
  orphans: { surface: "manage", summary: "drawers whose source file is gone; dry run by default", required: [], optional: ["wing", "room", "apply", "limit"] },
  closets: { surface: "manage", summary: "rebuild the closet ranking layer from current drawers", required: [], optional: ["wing", "limit", "apply"] },
  sync: { surface: "manage", summary: "prune drawers whose source is missing or gitignored", required: [], optional: ["projectDir", "wing", "apply"] },
  delete_by_source: { surface: "manage", summary: "remove every drawer from one source", required: ["sourceFile"], optional: ["apply"] },
  mine: { surface: "manage", summary: "import a project; dry run by default", required: [], optional: ["path", "wing", "limit", "apply"] },
  reconnect: { surface: "manage", summary: "reconnect after anything external touched the palace", required: [] },
  status: { surface: "manage", summary: "palace status: drawers, wings, rooms", required: [] },
  wake_up: { surface: "manage", summary: "reload the L0/L1 wake-up context", required: [], optional: ["wing", "allWings"] },
  hook_settings: { surface: "manage", summary: "read or set hook behaviour", required: [], optional: ["silentSave", "desktopToast"] },
  memories_filed_away: { surface: "manage", summary: "did the last checkpoint save, and when", required: [] },
};

export const RECALL_COMMANDS = Object.entries(COMMANDS).filter(([, spec]) => spec.surface === "recall").map(([name]) => name);
export const MANAGE_COMMANDS = Object.entries(COMMANDS).filter(([, spec]) => spec.surface === "manage").map(([name]) => name);

/** The parameters a surface's commands actually use — a smaller schema per tool. */
export function paramsForSurface(surface: Surface): string[] {
  const used = new Set<string>();
  for (const spec of Object.values(COMMANDS)) {
    if (spec.surface !== surface) continue;
    for (const param of [...spec.required, ...(spec.optional ?? [])]) used.add(param);
  }
  return [...used];
}

export const COMMAND_NAMES = Object.keys(COMMANDS);

/**
 * Validate a call before it runs. Returns the missing parameters, or the names
 * that belong to a different command, so a wrong call costs one round trip and
 * says what to do instead of failing inside the palace.
 */
export function validateCommand(
  command: string,
  given: Record<string, unknown>,
): { ok: true } | { ok: false; message: string } {
  const spec = COMMANDS[command];
  if (!spec) {
    const near = COMMAND_NAMES.filter((name) => name.startsWith(command.slice(0, 3))).slice(0, 6);
    return {
      ok: false,
      message:
        `Unknown command "${command}". Commands: ${COMMAND_NAMES.join(", ")}.` +
        (near.length > 0 ? ` Did you mean: ${near.join(", ")}?` : ""),
    };
  }

  const missing = spec.required.filter((name) => {
    const value = given[name];
    return value === undefined || value === null || String(value).trim() === "";
  });
  if (missing.length > 0) {
    return {
      ok: false,
      message:
        `command="${command}" needs ${missing.length === 1 ? "parameter" : "parameters"}: ${missing.join(", ")}. ` +
        `It accepts: ${[...spec.required, ...(spec.optional ?? [])].join(", ")}.`,
    };
  }

  const allowed = new Set([...spec.required, ...(spec.optional ?? [])]);
  const ignored = Object.keys(given).filter(
    (name) => name !== "command" && given[name] !== undefined && !allowed.has(name),
  );
  if (ignored.length > 0) {
    return {
      ok: false,
      message:
        `command="${command}" does not use ${ignored.length === 1 ? "parameter" : "parameters"}: ${ignored.join(", ")}. ` +
        `It accepts: ${[...spec.required, ...(spec.optional ?? [])].join(", ") || "(none)"}. ` +
        `A parameter that is silently ignored is worse than a refusal, so this call was not made.`,
    };
  }

  return { ok: true };
}
