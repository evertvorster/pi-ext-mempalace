#!/usr/bin/env python3
"""Answer "what do I have on this?" — with evidence for the absence case.

The palace ranks; it never rejects. A nonsense query therefore comes back with
five confident-looking results, and an honest "I don't know" becomes a guess
about my own ignorance. `tool_search` does accept `min_similarity`, though, and
the pi tool never exposes it — so this asks the palace a question it can answer
with "nothing above the line", and reports the scope it searched.

Payload (argv[1], JSON):
    query            required
    min_similarity   optional, default 0.45 — the line between "stored" and "noise"
    limit            optional, default 20
    include_kg       optional bool, default true — also ask the KG about the topic

Result goes to $KG_COVERAGE_OUTPUT; importing mempalace.mcp_server redirects
stdout to stderr.
"""
from __future__ import annotations

import json
import os
import sys
import traceback

ARCHIVE_ROOMS = {"transcripts", "diary"}


def emit(payload: dict) -> None:
    text = json.dumps(payload)
    out = os.environ.get("KG_COVERAGE_OUTPUT")
    if out:
        try:
            with open(out, "w", encoding="utf-8") as handle:
                handle.write(text + "\n")
        except OSError:
            pass
    print(text, flush=True)


def main() -> int:
    if len(sys.argv) < 2:
        emit({"ok": False, "error": "usage: coverage.py '<json payload>'"})
        return 2
    try:
        p = json.loads(sys.argv[1])
    except json.JSONDecodeError as exc:
        emit({"ok": False, "error": f"payload is not valid JSON: {exc}"})
        return 2

    query = str(p.get("query") or "").strip()
    if not query:
        emit({"ok": False, "error": "query is required"})
        return 2
    threshold = float(p.get("min_similarity") or 0.45)
    limit = int(p.get("limit") or 20)

    try:
        from mempalace import mcp_server as mcp
    except Exception as exc:  # pragma: no cover
        emit({"ok": False, "error": f"cannot import mempalace.mcp_server: {exc}"})
        return 1

    try:
        status = mcp.tool_status()
        taxonomy = (mcp.tool_get_taxonomy() or {}).get("taxonomy") or {}
        total_drawers = status.get("total_drawers")
        wings = len(taxonomy)
        rooms = len({room for got in taxonomy.values() for room in got})

        hits = mcp.tool_search(query=query, limit=limit, min_similarity=threshold)
        results = hits.get("results") or []

        # if nothing clears the line, find out how far off the nearest thing is
        nearest = None
        if not results:
            loose = mcp.tool_search(query=query, limit=3)
            loose_results = loose.get("results") or []
            if loose_results:
                top = loose_results[0]
                nearest = {
                    "wing": top.get("wing"),
                    "room": top.get("room"),
                    "similarity": round(float(top.get("similarity") or 0), 3),
                }

        # one row per drawer: chunks of the same drawer are not distinct evidence
        knowledge, seen = [], set()
        for r in results:
            if r.get("room") in ARCHIVE_ROOMS or r.get("room") == "general":
                continue
            key = r.get("drawer_id") or id(r)
            if key in seen:
                continue
            seen.add(key)
            knowledge.append(r)
        archive = [r for r in results if r not in knowledge]

        facts = None
        if p.get("include_kg", True):
            try:
                kg = mcp.tool_kg_query(entity=query, direction="both")
                active = [f for f in (kg.get("active_facts") or []) if f.get("current", True)]
                facts = active[:5]
            except Exception:
                facts = None

        if knowledge:
            verdict = "knowledge"
        elif archive:
            verdict = "archive-only"
        else:
            verdict = "nothing"

        emit({
            "ok": True,
            "data": {
                "query": query,
                "threshold": threshold,
                "verdict": verdict,
                "scope": {"drawers": total_drawers, "wings": wings, "rooms": rooms},
                "hit_count": len(results),
                "knowledge_hits": [
                    {"wing": r.get("wing"), "room": r.get("room"),
                     "similarity": round(float(r.get("similarity") or 0), 3),
                     "drawer_id": r.get("drawer_id")}
                    for r in knowledge[:8]
                ],
                "archive_hits": len(archive),
                "nearest_below_threshold": nearest,
                "kg_facts": [
                    {"predicate": f.get("predicate"), "object": f.get("object")}
                    for f in (facts or [])
                ],
            },
        })
        return 0
    except Exception as exc:
        emit({"ok": False, "error": str(exc), "details": traceback.format_exc()})
        return 1


if __name__ == "__main__":
    sys.exit(main())
