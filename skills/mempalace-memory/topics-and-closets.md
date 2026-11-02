# Topics, tunnels and closets

Read this before re-rooming anything, before claiming a cross-project connection exists, or after any
operation that moves drawers.

## The two axes

A drawer has exactly one `room`, and it means the **subject**:

- **`type`** (in the drawer text) is the memory **class** — `decision`, `problem`, `project_fact`.
- **`room`** is the **topic** — `shaders`, `packaging`, `cloud-deck-rendering`, `family`.

`type` → room is a default when no room is given, never an override. `evert/family` holds drawers typed
`project_fact`; rewriting them to `project-facts` destroys the topic in exchange for uniformity nobody
queries.

## Shared slugs are what create tunnels

The palace graph is: **nodes = rooms**, **edges = the same room name in two wings**. So
`SpaceSim/shaders` and `Vega-Strike/shaders` are a tunnel, and `traverse` walks it. Five independently
proposed room sets produce five vocabularies (`shaders` vs `render-shaders` vs `shader-craft-and-skills`)
and therefore **zero tunnels** — measured, when the migration was first attempted.

**Rule: propose per wing, then map onto one shared spine.** The spine in use:

```
shaders · godot · performance · packaging · local-models · calibre · vega-strike · mempalace
```

Per-wing specifics stay as local rooms (`cloud-deck-rendering`, `session-tree`, `qt-ui-…`). A subject
that appears in one wing only keeps its specific name; the moment it appears in two, it earns the spine
slug.

As measured after the 2026-11-02 migration: `packaging` spans 7 wings, `performance` 5, `shaders` 3,
`godot` 3, `vega-strike` 3, `mempalace` 3, `local-models` 2, `calibre` 2.

Non-palace reach is the graph's job, not a room's: `topic:shaders is_a topic`, then `<wing> about
topic:shaders`, `<skill> about topic:shaders`, `<repo> about topic:shaders`. That is how a skill file and
two projects become reachable from one query.

## `rooms apply` — the traps

- **`--from` defaults to `general,technical,architecture,planning,problems`**, which does not include
  `transcripts`. In a palace where capture lives in `transcripts`, the default moves almost nothing
  (215 of 4 310 drawers). Pass `--from …,transcripts`.
- It is **metadata-only** and uses stored embeddings — no re-embedding, no LLM call per drawer.
- It reports **"0 closets followed"** for any source whose drawers split across rooms. That is the closet
  layer going stale, not a broken move — see below.
- `rooms propose` needs a **generative** model. The palace has none: `llm_client.py` defaults to Ollama
  (`localhost:11434`), with `openai-compat` (llama.cpp, vLLM, LM Studio) and `anthropic` behind
  `--accept-external-llm`. The ONNX model in the stack is the **embedder** (`all-MiniLM-L6-v2`, 384-dim),
  not a generator.
- Small models invent rooms. Gemma-4-E2B on a 14-drawer sample produced 17 rooms, 4 with **no
  exemplars**; DeepSeek on an 80-drawer sample produced 14, none invented. Use a real sample and a
  capable model, and drop any room that cannot name its exemplars.
- **Propose from digests, not raw transcripts.** Proposed on raw JSONL, six of fifteen sampled drawers
  were our own prompt and two of the six rooms described the agent rather than the project.

## Closets — what they are and are not

A closet row is a **cue line pointing at drawers**:

```
dos machines|Machines;Python|→drawer_dos_machines_share_7f2d00…,drawer_dos_machines_share_f7c40a29…
```

- One closet can own **several drawers**, and it belongs to **one room**; lookups filter closets by the
  same wing+room `where` clause as the drawer search.
- They are a **rank boost, never a gate** (`_closet_boosts()`). A stale closet cannot hide or add
  drawers, it only fails to lift them — which is why room-scoped search kept working after a re-rooming
  while the boost quietly disappeared.
- After moving rooms, `command=orphans/closets(task="closets")` rebuilds from **current** drawers. **Never
  re-mine** a recaptured source to fix closets: mining would re-add the raw transcript and undo the
  digest pass.

## Verbs that are easy to confuse

| word | meaning |
|---|---|
| **wing** | a project / person / agent |
| **room** | a topic within a wing; the graph node |
| **tunnel** | the same room name in ≥2 wings (an edge) |
| **closet** | cue lines pointing at drawers, per wing+room; a ranking boost only |
| **hallway** | entity↔entity co-occurrence inside a wing, auto-generated |
| **hall** | the AAAK classification attached to a room (`hall_facts`, `hall_events`, …) |

## Naming a wing

The cwd-derived wing resolves from the nearest ancestor `mempalace.yaml` (`wing:` line, authoritative),
otherwise the directory name with characters outside `[A-Za-z0-9_-]` replaced by `_`. Case and hyphens
survive that fallback — but `mempalace mine` normalises the other way (lowercase, `-`→`_`). So a
directory whose name differs from its intended wing must be **pinned** in `mempalace.yaml`, or mining and
tool saves split one project in two. This has happened: a re-capture of old sessions created eight
junk wings (`llm-thalamus` beside `llm_thalamus`, `pi-ext-mempalace` beside `pi`, one per package
directory), all of which then had to be merged.

Wing hygiene, in one line each:

1. `pi` is the pi coding agent software. A scout run over a project's source is that *project's*
   knowledge, not `pi`'s.
2. Mine per project, from its own directory, with an explicit `--wing`.
3. One canonical name per project, pinned.
4. Capture follows the session cwd — never one shared `sessions` wing.
5. Re-mining after a cleanup means each project into its own wing with current state.
