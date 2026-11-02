#!/usr/bin/env python3
"""Find and optionally delete drawers whose source file no longer exists.

Why this exists: `mempalace_sync` reports such drawers as *unresolved* and then
does not prune them — it removes only the ones it classifies as *missing*. On
2026-11-02 that left 1 049 drawers in `notes-vault/general` untouched and the
cleanup needed 104 separate `delete_by_source` calls. This does the sweep in one
pass, dry-run by default.

Payload (argv[1], JSON):
    wing        optional — restrict to one wing
    room        optional — restrict to one room
    apply       optional bool, default false
    limit       optional int, safety cap on deletions per run (default 500)

Only absolute paths are considered: labels like "pi-session:…" and empty values
are deliberate provenance, not orphans. Result goes to $KG_ORPHANS_OUTPUT,
because importing mempalace.mcp_server redirects fd 1 to stderr.
"""
from __future__ import annotations

import json
import os
import sqlite3
import sys
from pathlib import Path


def emit(payload: dict) -> None:
    text = json.dumps(payload)
    out = os.environ.get("KG_ORPHANS_OUTPUT")
    if out:
        try:
            with open(out, "w", encoding="utf-8") as handle:
                handle.write(text + "\n")
        except OSError:
            pass
    print(text, flush=True)


def palace_path() -> Path:
    return Path(os.environ.get("MEMPALACE_PALACE_PATH") or (Path.home() / ".mempalace" / "palace")) / "chroma.sqlite3"


def source_rows(db: Path, wing: str | None, room: str | None):
    """(source_file, drawer_count) for the requested scope, straight from the palace."""
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    where = ["c.name = 'mempalace_drawers'", "m.key = 'source_file'", "m.string_value IS NOT NULL"]
    params: list[str] = []
    if room:
        where.append("e.id IN (SELECT e2.id FROM embedding_metadata e2 WHERE e2.key='room' AND e2.string_value=?)")
        params.append(room)
    if wing:
        where.append("e.id IN (SELECT e3.id FROM embedding_metadata e3 WHERE e3.key='wing' AND e3.string_value=?)")
        params.append(wing)
    sql = f"""
        SELECT m.string_value, COUNT(*) FROM embedding_metadata m
        JOIN embeddings e ON e.id = m.id
        JOIN segments s ON e.segment_id = s.id
        JOIN collections c ON s.collection = c.id
        WHERE {' AND '.join(where)}
        GROUP BY m.string_value
    """
    try:
        return con.execute(sql, params).fetchall()
    finally:
        con.close()


def main() -> int:
    if len(sys.argv) < 2:
        emit({"ok": False, "error": "usage: orphans.py '<json payload>'"})
        return 2
    try:
        p = json.loads(sys.argv[1])
    except json.JSONDecodeError as exc:
        emit({"ok": False, "error": f"payload is not valid JSON: {exc}"})
        return 2

    wing = str(p.get("wing") or "").strip() or None
    room = str(p.get("room") or "").strip() or None
    apply = bool(p.get("apply"))
    limit = int(p.get("limit") or 500)

    db = palace_path()
    if not db.is_file():
        emit({"ok": False, "error": f"palace not found at {db}"})
        return 1

    rows = source_rows(db, wing, room)
    orphans = [(s, n) for s, n in rows if s.startswith("/") and not Path(s).is_file()]
    orphans.sort(key=lambda item: -item[1])
    total_drawers = sum(n for _, n in orphans)

    report = {
        "scanned_sources": len(rows),
        "orphan_sources": len(orphans),
        "orphan_drawers": total_drawers,
        "apply": apply,
        "largest": [{"source": s, "drawers": n} for s, n in orphans[:10]],
    }

    if not apply or not orphans:
        report["deleted_sources"] = 0
        emit({"ok": True, "data": report})
        return 0

    from mempalace import mcp_server as mcp

    deleted_sources = deleted_drawers = 0
    for source, count in orphans[:limit]:
        res = mcp.tool_delete_by_source(source_file=source, dry_run=False)
        if isinstance(res, dict) and res.get("success") is False:
            report.setdefault("failures", []).append({"source": source, "error": res.get("error")})
            continue
        deleted_sources += 1
        deleted_drawers += count

    report.update(deleted_sources=deleted_sources, deleted_drawers=deleted_drawers)
    emit({"ok": True, "data": report})
    return 0


if __name__ == "__main__":
    sys.exit(main())
