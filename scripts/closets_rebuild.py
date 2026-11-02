#!/usr/bin/env python3
"""Rebuild the closet layer for a wing from its current drawers.

Closets are the ranking layer: a cue line per topic, pointing at drawer ids,
filtered by wing+room when a search is scoped. Re-rooming drawers leaves the
closets behind (the palace's `rooms apply` reports "0 closets followed"), so a
room-scoped search then ranks on embeddings alone.

This rebuilds them from what the drawers *now* are — no re-mining, which would
re-add the raw session JSONL and undo the digest pass.

Payload (argv[1], JSON):
    wing     optional — rebuild one wing (default: every wing)
    limit    optional — max sources per run (0 = all)
    apply    optional bool, default false

Writes JSON to $KG_CLOSETS_OUTPUT (importing mempalace redirects stdout).
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
import traceback
from collections import defaultdict


def emit(payload: dict) -> None:
    text = json.dumps(payload)
    out = os.environ.get("KG_CLOSETS_OUTPUT")
    if out:
        try:
            with open(out, "w", encoding="utf-8") as handle:
                handle.write(text + "\n")
        except OSError:
            pass
    print(text, flush=True)


def main() -> int:
    if len(sys.argv) < 2:
        emit({"ok": False, "error": "usage: closets_rebuild.py '<json payload>'"})
        return 2
    try:
        p = json.loads(sys.argv[1])
    except json.JSONDecodeError as exc:
        emit({"ok": False, "error": f"payload is not valid JSON: {exc}"})
        return 2

    wing = str(p.get("wing") or "").strip() or None
    limit = int(p.get("limit") or 0)
    apply = bool(p.get("apply"))

    try:
        # the palace exposes these through its package surface, not the fragments
        from mempalace.palace import (
            build_closet_lines,
            get_closets_collection,
            get_collection,
            purge_file_closets,
            upsert_closet_lines,
        )
        from mempalace.config import MempalaceConfig
    except Exception as exc:  # pragma: no cover
        emit({"ok": False, "error": f"cannot import palace helpers: {exc}"})
        return 1

    palace = str(MempalaceConfig().palace_path)
    drawers = get_collection(palace, create=False)
    where = {"wing": wing} if wing else None
    batch = drawers.get(include=["documents", "metadatas"], where=where)

    groups: dict[tuple[str, str, str], list[tuple[str, str]]] = defaultdict(list)
    for did, doc, meta in zip(batch["ids"], batch["documents"] or [], batch["metadatas"] or []):
        meta = meta or {}
        source = meta.get("source_file") or ""
        room = meta.get("room") or ""
        w = meta.get("wing") or ""
        if not source or not room:
            continue
        groups[(w, source, room)].append((did, doc or ""))

    sources = sorted({(w, s) for (w, s, _r) in groups})
    if limit:
        sources = sources[:limit]
    selected = {k for k in groups if (k[0], k[1]) in set(sources)}

    report = {
        "wing": wing or "(all)",
        "drawers": sum(len(groups[k]) for k in selected),
        "sources": len(sources),
        "room_groups": len(selected),
        "apply": apply,
        "closets_written": 0,
    }
    if not apply:
        emit({"ok": True, "data": report})
        return 0

    closets = get_closets_collection(palace)
    written = 0
    try:
        for (w, source) in sources:
            purge_file_closets(closets, source)   # drop stale cue lines for this source
            for key in [k for k in selected if k[0] == w and k[1] == source]:
                _, _, room = key
                pairs = groups[key]
                ids = [did for did, _ in pairs]
                content = "\n\n".join(doc for _, doc in pairs)
                lines = build_closet_lines(source, ids, content, w, room)
                if not lines:
                    continue
                base = "rc_" + hashlib.sha1(f"{source}|{room}".encode()).hexdigest()[:16]
                written += upsert_closet_lines(
                    closets, base, lines,
                    {"source_file": source, "wing": w, "room": room, "added_by": "closets_rebuild"},
                )
    except Exception as exc:
        emit({"ok": False, "error": str(exc), "details": traceback.format_exc(), "data": report})
        return 1

    report["closets_written"] = written
    emit({"ok": True, "data": report})
    return 0


if __name__ == "__main__":
    sys.exit(main())
