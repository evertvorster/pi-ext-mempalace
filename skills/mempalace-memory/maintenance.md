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
