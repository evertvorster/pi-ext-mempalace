# Maintenance

Read this before any operation that touches more than a handful of drawers. The palace has real data in
it, no undo, and a history of bulk operations that went wrong in ways only a complete scan caught.

## Start with the audit

```bash
mempalace audit --quiet --json        # layer scores + findings
mempalace repair-status               # read-only; do the vector index and SQLite disagree?
```

`audit` is read-only and names the current problems: room collapse, room-name drift, dust wings, unused
tunnels, knowledge-graph quality. It scores the room layer, which is how you tell a real improvement from
a reorganisation.

## Orphans and the sync gap

`command=sync` prunes drawers whose source is **missing or gitignored** — but it only *reports*
sources it cannot resolve. In one cleanup, 82 sources were pruned and 1 049 were listed as unresolved and
left in place.

```
command=orphans/closets(task="orphans")                  # dry run: counts and the largest sources
command=orphans/closets(task="orphans", apply=true)      # delete
```

Only **absolute paths** count as orphans; labels like `pi-session:…` are provenance, not files. Take a
`sqlite3 .backup` before applying — deletion is not reversible through the API.

## Capture ageing

Session capture is written as **digests**, not raw JSONL: user turns, the agent's prose, and tool *names*.
A 10 MB session becomes about 20 KB — 0.54% of the source — which is why search returns conversation
instead of file dumps.

- Raw session files stay on disk, so a digest is always re-derivable; nothing is lost by keeping them.
- Regenerating a digest means deriving from the source file, **never** re-mining it: mining would add the
  raw transcript back beside the digest and undo the pass.
- Order matters when recapturing: the digest carries the same `source_file` as the raw capture, so
  **delete first, then add**, or deleting by source removes the digest you just wrote.
- `add_drawer` refuses content over 100 000 characters. Long sessions need the digest split at a turn
  boundary.

## Closets

See [topics-and-closets](topics-and-closets.md) for what they are. The maintenance fact: after any
re-rooming, `command=orphans/closets(task="closets", wing=…, apply=true)` rebuilds them from current drawers.
Closets are a rank boost, never a gate — a stale closet degrades ranking but cannot hide a drawer.

## Repairing a broken vector index

Symptom: `std::vector::back() Assertion '!this->empty()' failed`, usually with `HNSW mtime gap … exceeds
threshold` warnings. The tell is a `link_lists.bin` of **0 bytes**.

```bash
mempalace repair-status     # compare SQLite rows with HNSW elements per collection
mempalace repair            # rebuild the index from the SQLite metadata
command=reconnect()       # in-session, afterwards
```

No data is lost: the SQLite file holds every vector and all metadata; the `.bin` files are only a cache.
If `repair` does not clear it, delete the caches and let Chroma rebuild — reach them by glob, never by a
hardcoded UUID, because the directory names change on every rebuild:

```bash
ls -la ~/.mempalace/palace/*/link_lists.bin    # 0 bytes → that graph is corrupt
rm ~/.mempalace/palace/*/*.bin
```

Other `mempalace` CLI verbs: `compress --wing X` (AAAK-compress a wing), `split <dir> --dry-run` (split
concatenated transcript files), `sweep <dir>` (idempotent per-message dedup), `migrate` (schema change).

## Palace internals — read before bulk wing/room work

### Two collections; never add their counts

| collection | what it is |
|---|---|
| `mempalace_drawers` | the memories |
| `mempalace_closets` | cue lines pointing at drawers; the ranking layer |

`chroma.sqlite3` holds one `embeddings` row per (segment, id), and each collection owns its own metadata
segment. An unscoped join across `embedding_metadata` **double-counts** — an audit once reported 27 874
rows where there were 16 826 drawers plus 11 048 closets. Resolve segment ids by name from the
`collections` table; never hardcode them.

### Metadata-only rewrites, not `update_drawer`

`col.update(ids=…, metadatas=…)` needs no embedder, so it is fast and works while the ONNX runtime is
busy. `command=update_drawer` re-embeds every chunk — right for tens of drawers, ruinous for thousands.
For a bulk move, rewrite metadata directly; for a small correction, use the tool.

### Never pass closet ids to the drawers collection

`col.get(ids=…)` **silently returns fewer rows than requested** for ids it does not hold. Pairing the
response positionally against the request then writes metadata onto the wrong drawers. Always key the
response by its own id.

### Closets usually have no `source_file`

Their text is AAAK, so a closet cannot be attributed on its own. To re-home them consistently with their
drawers, in order: by drawer id (the closet id often equals a drawer's logical id), then by its own
`source_file` when that points at a session file, then by the room-merge rule.

## Discipline for any bulk write

Learned by getting each of these wrong:

1. **Dry run, then read the diff.** Not the counts — the diff.
2. **Gate on shape.** A `PKGBUILD` regex that excluded the letter `s` wrote 35 malformed entities into
   the live graph and cost 67 invalidations. Anything generated mechanically gets a name-shaped sanity
   gate before `--apply`.
3. **Verify with a complete scan, not a sample.** A paged scan was truncated twice and reported as
   "clean" when it was not. Page properly, dedupe by key, and state the criteria.
4. **Back up before destructive passes.** `sqlite3 ~/.mempalace/palace/chroma.sqlite3 ".backup /path"`,
   then say where it is and when it can go.
5. **Serialise writes.** The palace holds a single writer lease: concurrent writes fail with
   "…held by PID …". Run write batches one at a time.
6. **Mechanical derivations may be automatic; semantic ones may not.** Type→room, entity resolution and
   spelling are safe. "What does this mean" and "what should this summary say" need the source retained
   and a human review path.

## Two traps that cost a session each

Both were hit on 2026-11-02 while writing a curated core into `dora`.

**Chroma's row id is not a drawer id.** Tool calls take the *logical* drawer id —
`drawer_<wing>_<room>_<hash>`, optionally with `_chunk_NNNNNN` stripped — obtained from `list_drawers`
or `get_drawer`. The integers in `chroma.sqlite3` are internal row ids; passing one to `update_drawer`
returns `Drawer not found`, and a `sqlite3` column three characters too narrow silently truncates a
real id into a plausible-looking wrong one. Read ids from the tool, not from the database.
Related wart: a drawer moved between wings by rewriting metadata **keeps its old wing in the id**, so
`drawer_evert_open-loops_…` can legitimately live in `dora`. Trust the `wing` metadata field, never the
id prefix.

**Parallel writes corrupt the moment, not the store.** Eight `remember` calls in one block produced five
"held by PID" refusals and one `Error deserializing pickle file: EOF while parsing` from an HNSW reader —
a concurrent write caught mid-flush. Reads were intact and a serial retry succeeded, but that is luck, not
design. `closets` is the repair for the ranking rows a move leaves behind: a moved drawer keeps a closet
entry in the source wing saying "removed now" until a rebuild, so run `closets` on the wing you moved
*out of*, not on the one you moved into.

## One session of history, for calibration

The 2026-11-02 cleanup, as a worked example of the above: a fresh `sqlite3 .backup`, then `sync` (82
sources), then 104 `delete_by_source` calls for the unresolved ones (1 318 drawers), taking the flat
`general` room from 1 625 drawers to 328 and the palace from 23 515 to 22 142. Then a recapture of 759
sessions into digests (1 038 MB → 22 MB), where the failure mode was 53 sources losing their drawers
because `add_drawer` refused digests over 100 000 characters *after* the delete — caught by comparing
against the backup, and repaired by splitting the digests.
