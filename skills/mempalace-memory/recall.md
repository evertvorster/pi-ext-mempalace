# Recall — the `mempalace` tool

Five commands, always declared, because reading is what a session does constantly. Everything that
*writes* to the palace lives on `mempalace_manage`, which is loaded only for a reflection session.

```
mempalace(command="search", query="PyAV metadata_errors", minSimilarity=0.45)
```

A call is validated before it runs: an unknown command is refused with near matches, a missing required
parameter is named, and a parameter the command would silently ignore is refused rather than dropped.

## `ask` — the honest answer, including "nothing"

```
command="ask", query, minSimilarity=0.45, limit=20, includeKg=true
```

Searches every wing, then reports **scope** (drawer, wing and room counts), hits above the line split
into knowledge versus archive, the nearest thing *below* the line, and a verdict:

- `knowledge found` — filed memories matched
- `archive only` — we talked about it, but nothing was filed as knowledge
- `nothing` — no drawer cleared the line, and here is the closest thing and where it lives

Use it before saying "I have nothing on that". Absence then is a measurement, not a claim.

## `search` — ranked hits

```
command="search", query, wing?, room?, limit=5, minSimilarity?, allWings?
```

- `minSimilarity` is the palace's own filter and the only way to make search *reject*. Without it a
  nonsense query returns five results at 0.2 with total confidence.
- Hits are **800-character previews**, deduped by `drawerId`, and the result says when a hit is a
  preview: `command="get_drawer", drawerId=…` is one call and gets the whole drawer.
- Hits from the current session are hidden — they contain the query wording and are already in context.
- A weak match (best < 0.40) is broadened across all wings with capture rooms excluded, under
  `════════ broadened ════════`, so filed knowledge gets one more chance before you conclude.
- Capture-only results are labelled: `transcripts`/`diary` is an event record, not knowledge.
- `allWings: true` searches everything; otherwise the current project wing is the default.

## `open_loops` — pending work

```
command="open_loops", wing?, query?, status?, limit=10, allWings?
```

Filters on each drawer's **own `status:` field**, not on query text, and reports how many finished loops
it hid. `status` defaults to `open`/`in_progress`/`blocked`; pass `any` to include `done`.

## `get_drawer` / `list_drawers`

`get_drawer(drawerId)` returns the full text — the thing search cannot. `list_drawers(wing?, room?,
limit, offset)` is paginated and shows `sourceFile` per drawer, which is how you audit provenance
without touching SQLite.

## When recall is not enough

If a question needs the knowledge graph (`what is X to Y, and since since when`), or the answer should
be *written down* rather than read, that is `mempalace_manage` — activate it with `/mempalace`. Do not
try to work around it with search: a fact is one call when the write surface is loaded, and a drawer
full of prose otherwise.
