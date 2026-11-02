# Tools

Forty tools: the package's own, and three that exist because a single `mempalace` command could not
express the job. The tool descriptions reach you automatically — this file is for the *choices*:
which one answers which question, and the parameters that are easy to miss.

Grouped by the question you are actually asking.

## "What do I know?" — recall

### `mempalace_ask` — the honest answer, including "nothing"

```
mempalace_ask(query, minSimilarity=0.45, limit=20, includeKg=true)
```

Searches every wing, then reports **scope** (how many drawers, wings, rooms), hits above the line split
into knowledge versus archive, the nearest thing *below* the line, and a verdict:

- `knowledge found` — filed memories matched
- `archive only` — we talked about it, but nothing was filed as knowledge
- `nothing` — no drawer cleared the line, and here is the closest thing and where it lives

Use it before saying "I have nothing on that". Absence is then a measurement rather than a claim.

### `mempalace_search` — ranked hits

```
mempalace_search(query, wing?, room?, limit=5, minSimilarity?, defaultToCurrentWing=true)
```

- `minSimilarity` is the palace's own filter, and it is the only way to make search *reject* rather
  than rank. A nonsense query otherwise returns five results at 0.2 with total confidence.
- Hits are **800-character previews**, deduped by `drawer_id`, and note it when a hit is a preview:
  call `mempalace_get_drawer` for the whole drawer.
- Hits from the current session are hidden — they contain the query wording and are already in context.
- A weak match (best < 0.40) is broadened across all wings with capture rooms excluded, labelled
  `════════ broadened ════════`, so filed knowledge gets one more chance before you conclude.
- Capture-only results are labelled: `transcripts`/`diary` means an event record, not knowledge.

### `mempalace_kg_query` — exact, typed, temporal

```
mempalace_kg_query(entity, predicate?, limit?, as_of?, direction="both")
```

`predicate` and `limit` exist because a hub entity has dozens of facts: `maintains` on a package
maintainer, `about` on a topic. Without them you get the whole graph neighbourhood and read none of it.
Rendering groups by predicate and states `(+N more)` and `(N ended facts hidden)`.

### `mempalace_open_loops` — pending work

```
mempalace_open_loops(wing?, query?, status?, limit=10, defaultToCurrentWing=true)
```

Filters on each drawer's **own `status:` field**, not on query text, and reports how many finished loops
it hid. `status` defaults to `open`/`in_progress`/`blocked`; pass `any` to see everything including `done`.

### `mempalace_get_drawer` / `mempalace_list_drawers`

`get_drawer(drawer_id)` returns the full text — the thing search cannot. `list_drawers(wing?, room?,
limit, offset)` is paginated and shows `source_file` per drawer, which is how you audit provenance
without touching SQLite.

### `mempalace_diary_read` / `mempalace_wake_up`

`diary_read(agent_name, last_n=10, wing?)` is chronological narrative. `wake_up(wing?)` re-injects the
L0/L1 primer; the session-start hook already did it, so call it only if it is missing.

## "File this" — write

### `mempalace_remember` — prose with a point

```
mempalace_remember(type, summary, wing?, room?, scope?, rationale?, details?, evidence?,
                   status?, priority?, category?, nextAction?, blockedBy?, owner?, due?,
                   source?, confidence?, duplicateThreshold=0.9, force=false)
```

`type` is required and picks the default room. On a near-duplicate it refuses and hands you the existing
`drawer_id` — update that drawer, or pass `force: true` if it really is a second memory.

### `mempalace_fact` — one checkable value, as structure

```
mempalace_fact(subject, predicate, object, summary?, oldObject?, at?,
               details?, evidence?, wing?, validFrom?, source?)
```

Files a **triple and a drawer** in one call, so structure costs one action instead of two. `summary` is
required when adding and ignored when superseding. `oldObject` is what makes it a supersede — see
[knowledge-graph](knowledge-graph.md).

### `mempalace_add_drawer` — verbatim text

```
mempalace_add_drawer(wing, room, content, source_file?)
```

For raw text that is not a memory with a type: a spec, a quote block, an imported document. The content
must carry a `type:` header or you must name an explicit room — an unclassified write is refused, because
that is how the flat buckets were born. Content over 100 000 characters is rejected; split it.

### `mempalace_update_drawer` / `mempalace_delete_drawer`

`update_drawer(drawer_id, content?, wing?, room?)` rewrites in place and **moves closets with it** — the
cheap, supported way to correct a room or fix a wrong memory, history and all. `delete_drawer` is
irreversible, has no dry run, and is the wrong tool for a memory that merely became untrue; supersede or
rewrite it instead.

### `mempalace_check_duplicate`

```
mempalace_check_duplicate(content, threshold=0.9)
```

Before filing anything long, or anything you suspect is already there.

## "Keep a record of the session"

- `mempalace_diary_write(agent_name, entry, topic?, wing?)` — narrative, my own voice, what I noticed.
- The hooks file an archive digest automatically at pre-compact and every 15 turns. Nothing manual.

## "Look at the shape of the palace"

- `mempalace_get_taxonomy()` — wing → room → count. This is how you learn the rooms that exist *now*;
  do not memorise them, and do not trust a list of them in a document.
- `mempalace_list_wings()`, `mempalace_list_rooms(wing?)`, `mempalace_status()`.
- `mempalace_graph_stats()` — rooms, room instances, edges per wing.
- `mempalace_traverse(start_room, max_hops=2)`, `mempalace_find_tunnels(wing_a?, wing_b?)`,
  `mempalace_follow_tunnels(wing, room)`, plus `create_tunnel` / `list_tunnels` / `delete_tunnel`.

  These assume idea-centric rooms: a tunnel is the *same room name* in two wings. With type-rooms
  (`decisions`, `problems`) every room is a tunnel and one hop returns the whole taxonomy. They only
  say something once rooms are topics — see [topics-and-closets](topics-and-closets.md).
- `mempalace_list_hallways(wing?)` — entity co-occurrence. Low signal on mined source code, where the
  "entities" are `QtCore` and `QtWidgets`; ignore `stability: 1, access_count: 0` rows.

## "Clean up or move things"

### `mempalace_maintain` — the two palace-wide passes

```
mempalace_maintain(task="orphans"|"closets", wing?, room?, apply=false, limit?)
```

- `task: "orphans"` — drawers whose absolute source path no longer exists. Dry run first, always. Only
  absolute paths count; labels like `pi-session:…` are provenance, not orphans.
- `task: "closets"` — rebuild the closet ranking layer from **current** drawers, for one wing or all.
  Needed after re-rooming. Never re-mine a source to fix closets: mining would re-add the raw
  transcript and undo the digest pass.

### `mempalace_delete_by_source` / `mempalace_sync`

`delete_by_source(source_file, dry_run=true)` removes every drawer from one source. `sync(project_dir?,
wing?, apply=false)` prunes drawers whose source is missing or gitignored — but it only *reports*
`unresolved` sources, which is why `maintain(task="orphans")` exists.

### `mempalace_mine_project` — importing a project

```
mempalace_mine_project(path?, wing?, mode="projects"|"convos", limit?, dryRun=true)
```

Dry run by default, and it should stay that way until you have looked at the counts. Mining normalises
wing names differently from the tool path (lowercase, `-`→`_`), so **pin the wing** in the project's
`mempalace.yaml` or mine with an explicit `--wing`, or one project ends up as two.

## Palace health

- `mempalace_reconnect()` — after anything external touched the palace.
- `mempalace_memories_filed_away()` — did the last checkpoint save, and when.
- `mempalace_hook_settings(silent_save?, desktop_toast?)` — hook behaviour.
- `mempalace_get_aaak_spec()` — the compressed memory format, for when a drawer's shape is unfamiliar.
