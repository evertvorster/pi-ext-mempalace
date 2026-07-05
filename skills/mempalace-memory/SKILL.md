---
name: mempalace-memory
description: Use MemPalace as durable long-term memory for pi. Load when the user asks to remember something, recall previous decisions/preferences/session context, review memory candidates, or work with MemPalace wings/rooms/tools.
---

# MemPalace Memory — Master Skill

MemPalace is pi's durable semantic memory layer. It stores searchable **drawers** organized by **wing** and **room**. Use it for long-term recall, not for automatic prompt injection.

## Two-tier memory model

MemPalace has two completely separate storage paths that serve different purposes:

### Tier 1: Structured memories (primary) — `mempalace_remember`

The main memory channel. Use `mempalace_remember` to file **typed, structured drawers**:
  - `decision` → stored in `decisions/` room
  - `preference` → `preferences/`
  - `milestone` → `milestones/`
  - `problem` → `problems/`
  - `workflow` → `workflows/`
  - `project_fact` → `project-facts/`
  - `quote` → `quotes/`
  - `emotional_context` → `emotional-context/`
  - `open_loop` → `open-loops/`

Each drawer has a concise **summary**, **rationale**, optional **evidence**, and **confidence** score.
These are the memories worth having in future sessions — what you decided and why.

### Tier 2: Auto-captured transcripts (safety net) — `{wing}/transcripts/`
The hooks **automatically** save full session transcripts into a `transcripts` room
within the agent's wing. This is a **noise floor** — raw verbatim conversation dumps,
not organized memories. They're there as a safety net if you need to dig up exact
context, but they are NOT meant to be the primary memory mechanism.

### Core rule

```text
discover -> propose -> classify -> file as drawer -> search later
```

Do **not** dump whole conversations into memory manually. The hooks do that
automatically into `transcripts/`. Use `mempalace_remember` for durable,
high-value structured memories.

### Sort at write time

A disorganized palace is barely better than no palace. Every memory must have a
clear **wing** and **room** — if you're unsure where something goes, the
category is likely wrong. Classification is the critical step: LLMs are good
at it *when told to do it*, and being deliberate at storage time is what makes
retrieval work later. A messy flat pile defeats the purpose of the hierarchy.

## Session hooks

- **Session start**: `mempalace wake-up` is called automatically, injecting L0/L1 context. Look for `[MemPalace Wake-Up Context]` at the start of the conversation.
- **Pre-compact**: Full transcript is filed into `{wing}/transcripts/` before context compression.
- **Turn-end (every 15 messages)**: Partial checkpoint filed into `{wing}/transcripts/`.

**If the wake-up context is missing** (no `[MemPalace Wake-Up Context]` at session start), call `mempalace_wake_up` manually to load it. Otherwise use `mempalace_search` for specific lookups — the wake-up already loaded the broad primer.

## GPU/ONNX coordination

Before vector-based operations (`search`, `open_loops`, `check_duplicate`, `remember`, `mine dryRun=false`), unload llama.cpp router models to avoid ONNX conflicts:

```bash
python - <<'PY'
import json, urllib.request
base = 'http://127.0.0.1:8080'
models = json.load(urllib.request.urlopen(base + '/models'))['data']
for m in models:
    if m.get('status', {}).get('value') == 'loaded':
        req = urllib.request.Request(
            base + '/models/unload',
            data=json.dumps({'model': m['id']}).encode(),
            headers={'Content-Type': 'application/json'},
            method='POST',
        )
        print(m['id'], urllib.request.urlopen(req).read().decode())
PY
```

Skip unload for: `status`, `wake_up`, `mine dryRun=true`, drawer listing, graph stats.

## Wing and room layout (current palace)

### Wings and their contents

| Wing | Scope |
|---|---|
| `dora/` | **Me (Dora)** — identity, personality, my diary, my decisions |
| `pi/` | **Pi software/ecosystem** — harness architecture, model insights, technical notes |
| `evert/` | **Evert (the user)** — identity, preferences, milestones, projects |
| `{project}/` | **Per-project** — e.g. `llm_thalamus/`, `dos_machines/`, `coqui-tts/` |

### `dora/` rooms — about the personality running inside pi

| Room | What goes there |
|---|---|
| `identity` | Who I am — name origin, role, personality |
| `decisions` | Decisions about my own behavior, configuration, personality |
| `preferences` | How I prefer to work, what I've learned about being effective |
| `workflows` | My preferred workflows and patterns |
| `milestones` | Milestones in my development as an agent |
| `problems` | Problems I've encountered with my own functioning |
| `project-facts` | Durable facts about me |
| `open-loops` | Things I want to follow up on across sessions |
| `diary` | What I've experienced, learned, and done across sessions |

### `pi/` rooms — about the pi software/harness itself

| Room | What goes there |
|---|---|
| `architecture` | Pi's internal architecture — extensions, event hooks, provider system |
| `technical` | Deep technical details about pi internals |
| `workflows` | How-to guides, procedures, patterns for using/extending pi |
| `decisions` | Decisions about pi configuration, setup, workflow |
| `problems` | Pi bugs, root causes, and fixes |
| `milestones` | Significant completions, releases, upgrades of pi |
| `model-insights` | Model comparisons, quirks, quant recommendations |
| `preferences` | Operational preferences about how pi is configured |
| `open-loops` / `open_loops` | Pending tasks, deferred decisions |
| `planning` | Plan documents and roadmap fragments |
| `transcripts` | Auto-captured session transcripts (safety net, not for primary use) |
| `diary` | Session wrap-ups via mempalace_diary_write |

### `evert/` rooms — everything about the user

| Room | What goes there |
|---|---|
| `identity` | Who Evert is — name, location, career, background |
| `preferences` | How Evert likes things done — philosophy, style, pet peeves |
| `operating-preferences` | System-level preferences (modes, software choices) |
| `decisions` | Decisions Evert has made about projects or workflow |
| `milestones` | Milestones in Evert's work |
| `problems` | Problems Evert has encountered |
| `project-facts` | Durable facts about projects |
| `projects` | Project listings and status |
| `workflows` | Evert's preferred workflows |
| `bugs` | Bug reports (especially KDE) |
| `debugging` | Debugging sessions |
| `hardware` | Machine specs and config |
| `open-loops` / `open_loops` | Pending items for Evert |

### Project wings — consistent rooms across projects

Per-project wings (e.g. `llm_thalamus`, `dos_machines`) follow a consistent structure: `decisions`, `milestones`, `problems`, `project-facts`, `open-loops`, `diary`, `design`, `architecture`, `documentation`, `configuration`, `testing`, `src`, `workflows`, `general`.

### How to decide where to save

1. **About me (Dora)?** → `dora/` — identity, preferences, workflows, diary
2. **About the pi harness/ecosystem?** → `pi/` — architecture, technical, model-insights
3. **About Evert?** → `evert/` — identity, preferences, decisions, milestones
4. **About a specific project?** → the project wing (e.g. `llm_thalamus/problems`)
5. **Unsure?** → default to the current project wing, that's always findable

### Retrieval scoping
1. Current project wing for project context
2. User wing (`evert`) for user preferences/facts
3. Agent wing (`dora/`) for agent-private memory
4. Avoid all-wing searches unless the question is genuinely cross-cutting

### Default rooms by type
- `decision` → `decisions`
- `preference` → `preferences`
- `milestone` → `milestones`
- `problem` → `problems`
- `emotional_context` → `emotional-context`
- `project_fact` → `project-facts`
- `workflow` → `workflows`
- `quote` → `quotes`
- `open_loop` → `open-loops`

## MemPalace vs Obsidian vault

Two complementary storage systems:

| | **MemPalace** (my memory) | **Obsidian vault** (Evert's doc store) |
|---|---|---|
| **Purpose** | My cross-session memory — fast, unstructured | Formal documentation — structured, curated |
| **Content** | Decisions, preferences, problems, workflows, model insights | Project plans, specs, architecture docs, procedures |
| **Format** | Typed drawers with metadata | Markdown with YAML frontmatter, wiki-links |
| **Search** | Semantic similarity (`mempalace_search`) | File path + wiki-link graph |
| **Who owns it** | Me (Dora/pi) | Evert curates, I can contribute |
| **Location** | `~/.mempalace/palace/` | `~/Insync/.../Google Drive/Notes/` |

**When to use which:**
- Quick save/recall for my own continuity → **MemPalace**
- Writing/rewriting formal documentation → **Obsidian vault** (easier to edit/link/organize)
- Something that should survive both my sessions AND Evert's note-taking → **both**

See `~/.pi/agent/skills/obsidian-vault/SKILL.md` for vault structure and conventions.

## Proactive memory retrieval

Search MemPalace **before responding** more often than seems necessary. With a large context window, loading relevant memories costs little but dramatically improves response quality. Evert explicitly prefers accuracy over speed.

Default scope: current project wing and/or `evert/` wing. Broaden only when the question crosses domains.

## Proactive memory storage

Evert has granted permanent permission to store memories proactively. If something is novel, important, or likely to be useful across sessions, save it. Don't wait for explicit instruction.

Preference over silence: better to save something and be wrong (Evert will correct) than to let knowledge disappear into session history.

## Memory format

```text
type: decision|preference|milestone|problem|emotional_context|project_fact|workflow|quote|open_loop
date: YYYY-MM-DD
scope: project/feature/topic
summary: concise durable memory
rationale: why this matters or why the decision was made
details: extra details if needed
evidence: short quote or source evidence
status: open|in_progress|blocked|done|dropped        # open_loop only
priority: low|medium|high|urgent                      # open_loop only
category: bug|feature|research|cleanup|decision_needed|maintenance|follow_up|documentation|packaging
next_action: concrete next step                       # open_loop only
blocked_by: blocker or none                           # open_loop only
owner: evert|pi|assistant|unknown                     # open_loop only
source: pi-session:<session-or-label>
confidence: low|medium|high
```

## What to save / not save

**Save:** decisions with rationale, stable preferences, completed milestones, bugs with fixes, reusable workflows, important quotes, pending follow-ups (open_loop), durable project facts.

**Don't save:** secrets/credentials, random chatter, transient command output, low-confidence guesses, every assistant response, ephemeral implementation details.

---

## Skills index

Domain-specific skills load automatically when relevant:

| Skill | Tools | When to use |
|---|---|---|
| [core-tools](core-tools.md) | status, search, remember, check_duplicate, open_loops, add_drawer, mine_project, wake_up | Remembering, searching, recalling prior context, filing raw content, mining projects, loading wake-up context |
| [drawer-crud](drawer-crud.md) | get_drawer, list_drawers, update_drawer, delete_drawer | Managing existing memories — listing, correcting, deleting |
| [knowledge-graph](knowledge-graph.md) | kg_query, kg_add, kg_invalidate, kg_timeline, kg_stats | Entity relationships, temporal facts, changing facts |
| [navigation](navigation.md) | traverse, find_tunnels, graph_stats, create/list/delete/follow tunnels, list/delete hallways, delete_by_source, sync | Cross-domain reasoning, entity co-occurrence links, bulk cleanup, palace-filesystem sync |
| [diary](diary.md) | diary_write, diary_read | Agent self-reflection, recording session observations |
| [discovery](discovery.md) | list_wings, list_rooms, get_taxonomy, get_aaak_spec, topic wings | Exploring what's stored, structural overview, auto-classification targets |
| [system](system.md) | reconnect, hook_settings, memories_filed_away | Palace health, checkpoint status, hook configuration |
| [maintenance](maintenance.md) | mempalace-repair, mempalace-compress, mempalace-split, mempalace-sweep, mempalace-migrate (pi commands + bash) | Palace maintenance operations — repair HNSW, compress AAAK, split/sweep transcripts |

---

## Known issues — HNSW vector index crash

### Symptom

```
/usr/include/c++/16.1.1/bits/stl_vector.h:1360:
std::vector::back() Assertion '!this->empty()' failed.
```

Accompanied by `HNSW mtime gap Xs exceeds threshold` warnings.

### Root cause

The HNSW graph file (`link_lists.bin`) is **0 bytes** — the graph edges are missing.
The data itself is intact in `chroma.sqlite3`; only the ephemeral graph cache is corrupt.

### Fix (standard workaround for ChromaDB 1.5.x)

```bash
# 1. Remove corrupt graph files — Chroma rebuilds from SQLite on next access
rm ~/.mempalace/palace/f22b4dd9-0160-472f-a5de-b2e8ab94288d/*.bin

# 2. Remove accumulated drift snapshots (optional, frees disk space)
rm -rf ~/.mempalace/palace/f22b4dd9-0160-472f-a5de-b2e8ab94288d.drift-*

# 3. Reconnect in-session
mempalace_reconnect()
```

No data loss. The SQLite backend (238 MB) holds all vector data and metadata.
The `.bin` files are a cache — Chroma regenerates them.

### Detection check

```bash
ls -la ~/.mempalace/palace/f22b4dd9-0160-472f-a5de-b2e8ab94288d/link_lists.bin
# If 0 bytes → graph is corrupt
```
