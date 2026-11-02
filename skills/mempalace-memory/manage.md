# Manage — the `mempalace_manage` tool

Thirty-one commands that change the palace. The tool is **deferred**: registered, findable by
`tool_search`, but not declared to the model and costing no request tokens until a reflection session
activates it with `/mempalace`.

That activation is deliberate. Writing to memory is a decision — a fact worth keeping, a decision with
rationale, a connection worth making — and a decision is better made in one focused pass than scattered
through work. See [reflecting](reflecting.md) for the procedure.

A call is validated before it runs: an unknown command is refused with near matches, a missing required
parameter is named, and a parameter the command would silently ignore is refused rather than dropped.

## "File this" — write

### `remember` — prose with a point

```
command="remember", summary, type?, wing?, room?, scope?, rationale?, details?, evidence?,
                    status?, priority?, category?, nextAction?, blockedBy?, owner?, due?,
                    source?, confidence?, duplicateThreshold=0.9, force=false
```

`type` picks the default room (`decision` → `decisions`, `project_fact` → `project-facts`, …). On a
near-duplicate it refuses and hands you the existing `drawerId` — update that drawer, or pass
`force: true` if it really is a second memory.

### `fact` — one checkable value, as structure

```
command="fact", subject, predicate, object, summary?, oldObject?, at?,
                details?, evidence?, wing?, validFrom?, source?
```

Files a **triple and a drawer** in one call, so structure costs one action instead of two. `oldObject`
is what makes it a supersede — see [knowledge-graph](knowledge-graph.md).

### `add_drawer` — verbatim text

```
command="add_drawer", wing, room, content, sourceFile?
```

For raw text that is not a memory with a type: a spec, a quote block, an imported document. The content
must carry a `type:` header or you must name an explicit room — an unclassified write is refused,
because that is how the flat buckets were born. Content over 100 000 characters is rejected; split it.

### `update_drawer` / `delete_drawer`

`update_drawer(drawerId, content?, wing?, room?)` rewrites in place and **moves closets with it** — the
cheap, supported way to correct a room or fix a wrong memory. `delete_drawer` is irreversible, has no
dry run, and is the wrong tool for a memory that merely became untrue; supersede or rewrite it instead.

### `check_duplicate`

```
command="check_duplicate", content, threshold=0.9
```

Before filing anything long, or anything you suspect is already there.

## "Keep a record of the session"

- `diary_write(agentName, entry, topic?, wing?)` — narrative, my own voice, what I noticed.
- The hooks file an archive digest automatically at pre-compact and every 15 turns. Nothing manual.

## "Look at the shape of the palace"

- `taxonomy(wing?)` — wing → room → count. This is how you learn the rooms that exist *now*; do not
  memorise them, and do not trust a list of them in a document.
- `graph_stats()` — rooms, room instances and edges per wing.
- `traverse(startRoom, maxHops=2)`, `find_tunnels(wingA?, wingB?)`, `follow_tunnels(wing, room)`,
  `create_tunnel(...)`, `list_tunnels(wing?)`, `delete_tunnel(tunnelId)`.

  These assume idea-centric rooms: a tunnel is the *same room name* in two wings. With type-rooms
  (`decisions`, `problems`) every room is a tunnel and one hop returns the whole taxonomy. They only
  say something once rooms are topics — see [topics-and-closets](topics-and-closets.md).

## "Clean up or move things"

### `orphans` / `closets` — the two palace-wide passes

```
command="orphans", wing?, room?, apply=false, limit?
command="closets", wing?, apply=false, limit?
```

- `orphans` — drawers whose absolute source path no longer exists. Dry run first, always. Only absolute
  paths count; labels like `pi-session:…` are provenance, not orphans.
- `closets` — rebuild the closet ranking layer from **current** drawers, for one wing or all. Needed
  after re-rooming. Never re-mine a source to fix closets: mining would re-add the raw transcript and
  undo the digest pass.

### `sync` / `delete_by_source` / `mine`

`sync(projectDir?, wing?, apply=false)` prunes drawers whose source is missing or gitignored — but it
only *reports* `unresolved` sources, which is why `orphans` exists. `delete_by_source(sourceFile,
apply=false)` removes every drawer from one source. `mine(path?, wing?, limit?, apply=false)` imports a
project, dry run by default.

Mining normalises wing names differently from the tool path (lowercase, `-`→`_`), so **pin the wing** in
the project's `mempalace.yaml` or pass an explicit `wing`, or one project ends up as two.

## Palace health

- `reconnect()` — after anything external touched the palace.
- `memories_filed_away()` — did the last checkpoint save, and when.
- `hook_settings(silentSave?, desktopToast?)` — hook behaviour.
- `status()` — drawers, wings, rooms, palace path.

The AAAK drawer format is documented in [[topics-and-closets]]'s vocabulary table and in
`python-mempalace` itself; it is no longer a command, because a tool that prints a static document is
documentation with a schema.
