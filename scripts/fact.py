#!/usr/bin/env python3
"""File a durable fact as BOTH a knowledge-graph triple and a drawer.

Why: a fact stated only in prose is findable but not queryable; a fact stated
only as a triple has no rationale or evidence. Writing both in one call makes
the structured path the cheap one, instead of something to remember to do
afterwards.

Payload (argv[1], JSON):
    subject, predicate, object      required — the triple
    summary                          required — one-line statement for the drawer
    details, evidence                optional
    wing                             optional, default "pi"
    valid_from                       optional, YYYY-MM-DD
    source                           optional, default "pi-session:memory-fact"

Writes the result to $KG_FACT_OUTPUT as JSON, because importing
mempalace.mcp_server redirects fd 1 to stderr (see kg_supersede.py).
"""
from __future__ import annotations

import json
import os
import sys
import time
import traceback
from datetime import date


def emit(payload: dict) -> None:
    text = json.dumps(payload)
    out = os.environ.get("KG_FACT_OUTPUT")
    if out:
        try:
            with open(out, "w", encoding="utf-8") as handle:
                handle.write(text + "\n")
        except OSError:
            pass
    print(text, flush=True)


def in_band_failure(result) -> str | None:
    if not isinstance(result, dict):
        return None
    if result.get("success") is False:
        return str(result.get("error") or "mempalace reported failure")
    if "error" in result and "success" not in result:
        return str(result.get("error") or "mempalace reported failure")
    return None


def main() -> int:
    if len(sys.argv) < 2:
        emit({"ok": False, "error": "usage: fact.py '<json payload>'"})
        return 2
    try:
        p = json.loads(sys.argv[1])
    except json.JSONDecodeError as exc:
        emit({"ok": False, "error": f"payload is not valid JSON: {exc}"})
        return 2

    for field in ("subject", "predicate", "object", "summary"):
        if not str(p.get(field, "")).strip():
            emit({"ok": False, "error": f"{field} is required and was empty"})
            return 2

    try:
        from mempalace import mcp_server as mcp
    except Exception as exc:  # pragma: no cover
        emit({"ok": False, "error": f"cannot import mempalace.mcp_server: {exc}"})
        return 1

    subject = str(p["subject"]).strip()
    predicate = str(p["predicate"]).strip()
    obj = str(p["object"]).strip()
    summary = str(p["summary"]).strip()

    # 1. the triple
    triple = mcp.tool_kg_add(
        subject=subject,
        predicate=predicate,
        object=obj,
        valid_from=p.get("valid_from"),
    )
    failure = in_band_failure(triple)
    if failure:
        emit({"ok": False, "error": f"triple rejected: {failure}", "details": triple})
        return 1

    # 2. the drawer, in the room the type implies
    lines = [
        "type: project_fact",
        f"date: {p.get('date') or date.today().isoformat()}",
        f"summary: {summary}",
        f"triple: {subject} → {predicate} → {obj}",
    ]
    if p.get("details"):
        lines.append(f"details: {str(p['details']).strip()}")
    if p.get("evidence"):
        lines.append(f"evidence: {str(p['evidence']).strip()}")
    lines.append(f"source: {p.get('source') or 'pi-session:memory-fact'}")
    content = "\n".join(lines)

    # The palace takes a single writer lease; a concurrent call fails with
    # "…is held by PID …". Retrying is the difference between a half-write
    # (triple filed, drawer lost) and a complete one.
    drawer = None
    failure = None
    for attempt in range(6):
        drawer = mcp.tool_add_drawer(
            wing=str(p.get("wing") or "pi"),
            room="project-facts",
            content=content,
            source_file=str(p.get("source") or "pi-session:memory-fact"),
            added_by="pi",
        )
        failure = in_band_failure(drawer)
        if failure is None:
            break
        if "is held by" in failure and attempt < 5:
            time.sleep(1.5 * (attempt + 1))
            continue
        break
    if failure:
        emit(
            {
                "ok": False,
                "error": f"triple written but the drawer failed: {failure}",
                "details": {"triple": triple, "drawer": drawer},
            }
        )
        return 1

    emit(
        {
            "ok": True,
            "data": {
                "triple_id": triple.get("triple_id"),
                "fact": triple.get("fact"),
                "drawer_id": drawer.get("drawer_id"),
                "room": "project-facts",
            },
        }
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
