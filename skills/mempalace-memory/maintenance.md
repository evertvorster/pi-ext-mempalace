---
name: mempalace-maintenance
description: MemPalace CLI maintenance commands — repair, compress, split, sweep, migrate. Use for palace health and maintenance operations.
---

# MemPalace Maintenance Commands

These are registered as pi commands (available in the command palette / TUI) and also callable via bash. They run the `mempalace` binary internally.

## mempalace-repair

Rebuild palace vector index from SQLite metadata. Use when vector search is broken or the HNSW index has diverged.

```bash
mempalace repair
```

**Check HNSW health first:**
```bash
mempalace repair-status
```

## mempalace-compress

Compress drawers in a wing using AAAK Dialect. Reduces storage footprint.

```bash
mempalace compress --wing pi
```

## mempalace-split

Split concatenated transcript mega-files into per-session files. Use before mining to get per-message recall.

```bash
mempalace split <dir> [--dry-run]
```

**Always run `--dry-run` first** to preview what will be split without making changes.

## mempalace-sweep

Deduplicate against prior writes via deterministic drawer IDs + timestamp cursor. Stores one verbatim drawer per user/assistant message, idempotent and resume-safe.

```bash
mempalace sweep <transcript-dir>
```

**Run periodically** for per-message recall on top of file-level chunks produced by hooks.

## mempalace-migrate

Migrate palace from a different ChromaDB version. Use when upgrading mempalace to a new version.

```bash
mempalace migrate
```

## Via bash

All maintenance commands can be run in a bash shell:

```bash
mempalace repair
mempalace compress --wing pi
mempalace split ./transcripts --dry-run
mempalace sweep ./transcripts
mempalace migrate
```

## Palace internals — read before any bulk wing/room work

### Two collections; never add their counts

| collection | what it is |
|---|---|
| `mempalace_drawers` | the memories |
| `mempalace_closets` | the AAAK search-index layer, one entry per source file at mine time |

`chroma.sqlite3` holds one `embeddings` row per (segment, id), and each
collection owns its own METADATA segment. An unscoped join across
`embedding_metadata` therefore **double-counts** — a real audit once reported
27,874 rows when there were 16,826 drawers + 11,048 closets, inflating every
per-room figure by about 1.65×. Resolve segment ids by name from the
`collections` table; never hardcode them.

### Closets carry `wing`/`room` but usually no `source_file`

Their text is AAAK, so a closet cannot be attributed on its own. To re-home
them consistently with their drawers, in this order:

1. **By drawer id** — a closet id often equals a drawer's logical id
   (`parent_drawer_id` if chunked, else its own id). Covers 889 of the 891
   `pi/diary` closets.
2. **By its own `source_file`** when that points at a session JSONL — this is
   what works for captured transcripts.
3. **By room-merge rule** otherwise. Mined `closet_*` rows have no drawer twin
   and stay put.

### Never pass closet ids to the drawers collection

`col.get(ids=…)` **silently returns fewer rows than requested** for ids it does
not hold. Pairing the response positionally against the request then writes
metadata onto the *wrong* drawers. Always key the response by its own id.

### Re-home metadata only

A metadata-only rewrite (`col.update(ids=…, metadatas=…)`, the mechanism
`mempalace.migrate._apply_wing_updates` uses) needs no embedder, so it is fast
and works while the ONNX runtime is busy. `mempalace_update_drawer` re-embeds
every chunk instead — fine for tens of drawers, ruinous for thousands.

### Rehearse first

Copy the palace to a sandbox and run the write path there before touching the
real one. Both bugs above were found that way, not in production. Write an
undo record of the affected rows' current `wing`/`room` before applying, and
**assert that a target wing already exists** — a re-home must never mint a new
wing.

A worked example of all of this lives in
`~/.mempalace/maintenance/2026-09-25-wing-cleanup/` (`audit.py`, `rehome.py`,
`undo.py`, `REPORT.md`).
