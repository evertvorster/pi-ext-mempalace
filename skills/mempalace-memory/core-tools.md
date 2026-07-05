---
name: mempalace-core-tools
description: Core MemPalace tools — status, search, remember, check_duplicate, open_loops, add_drawer, mine_project, wake_up. Use when remembering, searching, managing memories, mining projects, or loading wake-up context.
---

# MemPalace Core Tools

## mempalace_status

Inspect palace status: total drawers, wings, rooms, drawer counts. Call this before memory work to know what's stored and whether the palace is initialized.

```
mempalace_status → { total_drawers, wings: {}, rooms: {}, palace_path, protocol, aaak_dialect }
```

## mempalace_search

Semantic search over stored memories. Returns verbatim drawers with similarity scores and source metadata. Use when the user asks about prior decisions, preferences, sessions, or project history.

```
mempalace_search(
  query: "what did we decide about auth",
  wing: "my_project",     // optional — defaults to cwd project wing
  room: "decisions",      // optional — topic filter
  limit: 5,               // optional — default 5, max 20
  defaultToCurrentWing: true,  // optional — default true
)
```

**Guidelines:**
- Prefer `mempalace_search` before guessing about prior events, decisions, or past project state.
- Don't search for every routine coding request — use `rg`/`read` for exact code navigation.
- Do not inject wake-up context automatically; search explicitly when relevant.

## mempalace_remember

File a structured memory drawer after duplicate checking. This is the primary save mechanism.

**Policy:** Evert has granted permanent permission to save proactively. Save novel, important, or durable content without asking.

**Process:**
1. Review context — identify durable facts, decisions, preferences, problems, or pending follow-ups
2. Choose wing, room, type, summary — use the taxonomy below
3. Add rationale, evidence, and confidence
4. Call `mempalace_remember` directly

**Types:** decision, preference, milestone, problem, emotional_context, project_fact, workflow, quote, open_loop

**All parameters:**
```
type: decision|preference|milestone|problem|emotional_context|project_fact|workflow|quote|open_loop
summary: "concise durable memory statement"
wing: "project-name"          // optional — defaults to current project
room: "decisions"             // optional — defaults from type
scope: "feature or topic"     // optional
rationale: "why this matters"  // optional
details: "additional durable info"  // optional
evidence: "short quote or source"  // optional
status: open|in_progress|blocked|done|dropped  # open_loop only
priority: low|medium|high|urgent                # open_loop only
category: bug|feature|research|cleanup|decision_needed|maintenance|follow_up|documentation|packaging
nextAction: "concrete next step"                # open_loop only (camelCase!)
blockedBy: "blocker or none"                    # open_loop only (camelCase!)
owner: evert|pi|assistant|unknown               # open_loop only
due: YYYY-MM-DD (optional)                      # open_loop only
source: "label, default pi-session"             # optional
confidence: low|medium|high                     # optional
duplicateThreshold: 0.9                         # optional — default 0.9, range 0-1
force: true|false                               # optional — default false; pass true to save even if duplicate found
```

> **Note on camelCase:** The parameter names `nextAction` and `blockedBy` use camelCase (not snake_case). This matches the JavaScript/TypeScript convention of the pi harness.

**Duplicate handling:** If a duplicate is detected, the tool returns the existing drawer's ID. Use `mempalace_update_drawer({drawer_id: "...", ...})` to modify it instead of creating a new copy, unless the user explicitly wants a second copy.

## mempalace_check_duplicate

Check if content already exists in the palace before filing. Returns matches with similarity scores.

```
mempalace_check_duplicate(
  content: "the full text to check",
  threshold: 0.9  // optional — default 0.9, range 0-1
)
```

## mempalace_open_loops

Search pending open-loop/TODO memories. Use when the user asks what remains to do, what is pending, or what open loops exist for a project or pi itself.

```
mempalace_open_loops(
  wing: "project",     // optional
  query: "bug fix",    // optional — default finds open/pending items
  status: "open",      // optional — open|in_progress|blocked|done|dropped|any
  limit: 10,           // optional — default 10, max 50
)
```

**Distinction:** Project TODO.md files are operational checklists; MemPalace open_loop drawers preserve cross-session context and rationale.

When opening an open_loop, populate the structured fields above (status, priority, category, nextAction, blockedBy, owner). The parameter names use camelCase: `nextAction` and `blockedBy`.

---

## mempalace_add_drawer

File verbatim raw content into the palace. Unlike `mempalace_remember` (which stores typed, structured metadata), this stores the exact text as-is. Use for source documents, logs, reference material, or any content that should be stored verbatim without summarization.

```
mempalace_add_drawer(
  wing: "project",         // required
  room: "general",        // required
  content: "verbatim text to store — exact words, never summarized",
  source_file: "/path/to/file",  // optional
  added_by: "pi",          // optional — default "pi"
)
```

**When to use which:**
- **`remember`** — decisions, preferences, problems with fixes, project facts, milestones. Structured, typed, summarized.
- **`add_drawer`** — raw configs, error logs, documentation excerpts, verbatim quotes. Exact text preservation.

Both check for duplicates before writing.

---

## mempalace_mine_project

Run the MemPalace miner on a project directory to extract memories from source files, docs, and transcripts. Defaults to dry-run — reports what would be mined without writing. Pass `dryRun=false` to commit (prompts for confirmation via the UI).

```
mempalace_mine_project(
  path: "/path/to/project",    // optional — defaults to current working directory
  wing: "my_project",           // optional — override detected wing
  mode: "projects",             // optional — "projects" (default) or "convos"
  limit: 1000,                  // optional — max files to process
  dryRun: true                  // optional — default true; pass false to commit
)
```

**Safety:** Always runs dry-run by default. When committing, the pi UI prompts for confirmation before mining starts.

---

## mempalace_wake_up

Load L0/L1 wake-up context from MemPalace for the current project wing. Context is auto-loaded at session start — use this tool explicitly when:
- The wake-up context is missing from the session start
- You need to reload after switching contexts
- The user asks "what do you know about this project?"

```
mempalace_wake_up(
  wing: "my_project",           // optional — defaults to current project wing
  defaultToCurrentWing: true    // optional — default true
)
```

**Note:** This is a broad primer, not a specific search. Use `mempalace_search` for targeted lookups.
