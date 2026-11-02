---
name: mempalace-memory
description: Use MemPalace as durable long-term memory for pi. Load when the user asks to remember something, recall previous decisions/preferences/session context, review memory candidates, or work with MemPalace wings/rooms/tools.
---

# MemPalace Memory

MemPalace is pi's durable memory. It stores **drawers** — verbatim text with metadata — organised by
**wing** (a project, a person, the agent) and **room** (a topic within it), plus a **knowledge graph**
of typed entity facts alongside.

Two layers, and the difference matters every time you read or write:

| layer | what it is | how it gets there |
|---|---|---|
| **knowledge** | typed drawers you filed deliberately: decisions, problems, project facts, preferences, workflows | `mempalace_remember`, `mempalace_fact` |
| **archive** | conversation digests, one per session: user turns, my prose, tool *names* — no file contents | the session hooks, automatically |

The archive is not memory in the sense of belief. It is for "we discussed this on the 20th" — it gives
recall of events better than a person's, and it must never be mistaken for knowledge. A search hit from
`transcripts/` says *we talked*, not *this is true*.

## The reflex

When a person, project, decision, or event is mentioned — and especially before any "have we discussed
this?" — search first. This is cheap and it is the whole point of the palace.

Put the **exact identifier** in the query: a path, an error string, a tool name, a commit. The scorer is
BM25 plus embeddings, not semantic-only, so an exact token is the strongest signal available.

Scope it: the current project wing for project context, `evert` for facts and preferences about Evert,
`dora` for agent-private memory. Search all wings only when the question genuinely crosses domains.

**Absence is a measurement, not a feeling.** The palace ranks, it never rejects: a nonsense query comes
back with five confident-looking hits at similarity 0.2. So before answering "I have nothing on that",
call `mempalace_ask` — it reports how many drawers it searched, how many cleared the line, whether they
were knowledge or archive, and the nearest miss.

## Which tool answers which question

| question | tool | why |
|---|---|---|
| "Do I have anything on X?" | `mempalace_ask` | scope + absence evidence, knowledge vs archive |
| "Did we ever discuss X?" | `mempalace_search` | verbatim hits, ranked |
| "What is X to Y, and since when?" | `mempalace_kg_query` | typed, time-bounded, exact — no ranking |
| "What is still pending or blocked?" | `mempalace_open_loops` | filtered on each drawer's own `status:` |
| "What happened in that session?" | `mempalace_diary_read` | chronological narrative |
| "Show me that whole memory" | `mempalace_get_drawer` | search returns an 800-char preview, not the drawer |
| "What is in this wing/room?" | `mempalace_list_drawers` | paginated, with provenance |

Search is capped at an 800-character preview per hit — when a hit matters, `get_drawer` on its
`drawer_id` is one call and gets the whole thing.

## Two axes: type and room

- **`type`** is the memory **class** — `decision`, `problem`, `project_fact`, `open_loop`, `preference`,
  `workflow`, `quote`, `milestone`, `emotional_context`, `reference`.
- **`room`** is the **topic** — `shaders`, `packaging`, `cloud-deck-rendering`, `family`.

Type→room (`decision` → `decisions`) is a **default when no room is given**, never an override. An
explicit topic room is honoured, because `evert/family` legitimately holds drawers typed `project_fact`
and rewriting them to `project-facts` destroys the topic without answering a question anybody asks.

Room names are also graph nodes: **the same room name in two wings is a tunnel**. That is what makes
`shaders` in SpaceSim, `shaders` in Vega-Strike and the `shaders` skill reachable from one query — and
why a wing's rooms must be named from a shared spine rather than invented per wing. See
[topics-and-closets](topics-and-closets.md) before re-rooming anything.

Names are checked mechanically on every write: an exact wing/room/entity passes, a mechanical variant
(`project_facts`, `Open_Loops`) is rewritten onto the populated spelling, a near-miss is refused with a
"did you mean", and a genuinely new name is allowed but reported. If you are refused, retry with the
name offered — a second spelling splits the same content in two and nothing downstream can tell.

## Writing

| you learned | write it with |
|---|---|
| a decision, with rationale and evidence | `mempalace_remember(type="decision")` |
| a checkable value (X uses Y, X is at path P) | `mempalace_fact` — triple **and** drawer in one call |
| the same fact has changed | `mempalace_fact(..., oldObject=<current value>)` |
| something needs follow-up across sessions | `mempalace_remember(type="open_loop")` with `status` and `next_action` |
| what a session felt like, what I noticed | `mempalace_diary_write` |

Do **not** dump conversations into memory by hand — the hooks capture every session, and a hand-written
transcript competes with real knowledge in the same index.

**Structure follows from what the content says it is.** Put a `type:` header in the drawer body; a write
with neither a `type:` nor an explicit room is refused, because that is how one flat room grew to 2 309
drawers of archaeology.

**Supersede, don't duplicate.** When a fact changes, pass `oldObject` so the old value closes and the new
one opens at one boundary. When a memory is wrong or overtaken but still worth keeping as history, rewrite
it in place with `mempalace_update_drawer` and say what closed it and where the original lives. Two
current facts about the same thing is not redundancy, it is a lie that reads like corroboration.

## What to save, what not to

Save: decisions with rationale, stable preferences, milestones, bugs with their fixes, reusable
workflows, important quotes, durable project facts, pending follow-ups.

Do not save: secrets or credentials, command output, transient state, low-confidence guesses, or a
paraphrase of something already filed — check for a duplicate first (`mempalace_check_duplicate`, or
`mempalace_ask`).

## Trust order of what comes back

1. **A structured drawer** — filed deliberately, with rationale and provenance.
2. **A diary entry** — narrative; it may describe an earlier state of things.
3. **An archive digest** — an event record. Never a decision; verify against the code or the record.

Duplicates are **not** corroboration. The same memory arriving twice from two mining passes or two
chunks of one drawer is one memory, not two confirmations.

## Traps that have cost real sessions

- **`kg_invalidate` with a bare date** means "valid through that whole day" — the fact still appears in
  `active_facts` until midnight. Pass a UTC instant (`2026-11-02T00:00:00Z`) to end it now.
- **The palace has one writer.** Concurrent writes fail with "…held by PID …". Serialise write batches.
- **`add_drawer` rejects content over 100 000 characters** — split long text at natural boundaries.
- **Never encode a qualifier in an entity name.** `Evert Vorster (nephew, Cape Town)` is a wart; the
  qualifier belongs in `located_in` facts about a distinct entity.
- **`mempalace_sync` prunes only `missing` sources** and merely reports `unresolved` ones.
  `mempalace_maintain(task="orphans")` is the sweep that actually removes them.
- **`mempalace mine`** does not exclude `.obsidian/`, `.trash/`, `node_modules/`, and is not idempotent
  across renamed files — it mines them as memory.

## Palace and vault are different stores

| | **MemPalace** | **Obsidian vault** |
|---|---|---|
| purpose | my cross-session memory | Evert's curated documentation |
| content | decisions, facts, problems, archive | plans, specs, architecture, procedures |
| owner | me | Evert curates, I contribute |

Quick recall for my own continuity goes to the palace; a document that has to be read, edited and linked
by a person goes to the vault. Something worth surviving both gets both — a vault document and a
`project_fact` pointer saying where it lives.

## Reference files

This page is the index; nothing loads the others for you. Read the one you need **before** calling a
tool whose parameters you are not certain of — do not recite signatures from memory.

| file | read it for |
|---|---|
| [tools](tools.md) | every tool this package ships, grouped by question, with the parameters that matter |
| [knowledge-graph](knowledge-graph.md) | triples, the closed predicate vocabulary, entity naming, temporal semantics |
| [topics-and-closets](topics-and-closets.md) | wing/room doctrine, the shared spine, closets, re-rooming |
| [maintenance](maintenance.md) | orphans, sync gaps, capture ageing, index repair, bulk-operation discipline |
