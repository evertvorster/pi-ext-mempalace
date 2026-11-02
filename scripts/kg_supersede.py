#!/usr/bin/env python3
"""Call MemPalace's ``tool_kg_supersede`` with a JSON payload from argv[1].

Prints exactly one JSON line::

    {"ok": true,  "data": {...}}
    {"ok": false, "error": "...", "details": {...}}

Why this exists: ``python-mempalace`` 3.11.0 ships
``tool_kg_supersede`` (mcp_server/tools_kg.py) and MemPalace's own injected
protocol tells the agent to use ``mempalace_kg_supersede`` when a single-valued
fact changes. ``pi-ext-mempalace`` 0.2.1 predates it and registers no such
tool, so the agent was hand-rolling invalidate + add — the exact failure the
protocol warns about. This personal extension closes the gap without editing
the system-wide package.
"""
from __future__ import annotations

import json
import os
import sys
import traceback


def emit(payload: dict) -> None:
    """Emit one JSON line.

    ``mempalace.mcp_server`` performs stdio protection on import
    (``os.dup2(2, 1)`` plus ``sys.stdout = sys.stderr``), so after it is
    imported *fd 1 is stderr* — writing the result there would be
    indistinguishable from diagnostics. The caller therefore passes a file
    path in ``KG_SUPERSEDE_OUTPUT``, exactly as pi-ext-mempalace's bridge.py
    does with ``MEMPALACE_BRIDGE_OUTPUT``. The print() below is a best-effort
    duplicate for a human running this helper by hand.
    """
    text = json.dumps(payload)
    out_path = os.environ.get("KG_SUPERSEDE_OUTPUT")
    if out_path:
        try:
            with open(out_path, "w", encoding="utf-8") as handle:
                handle.write(text)
                handle.write("\n")
        except OSError:
            pass
    print(text, flush=True)


def is_in_band_failure(result) -> str | None:
    """Mirror bridge.py: MemPalace returns failures instead of raising."""
    if not isinstance(result, dict):
        return None
    if result.get("success") is False:
        return str(result.get("error") or "mempalace reported failure")
    if "error" in result and "success" not in result:
        return str(result.get("error") or "mempalace reported failure")
    return None


def current_objects(mcp, subject: str, predicate: str) -> list[str] | None:
    """Return the currently-open objects for (subject, predicate), or None if unknown.

    ``tool_kg_supersede`` closes whatever matches ``old_object`` and opens
    ``new_object`` — it never checks that the old value is actually recorded.
    Superseding a value that is not recorded therefore does not correct the
    history, it silently adds a second current fact. This check turns that
    silent corruption into a refusal.
    """
    try:
        result = mcp.tool_kg_query(entity=subject, direction="outgoing")
    except Exception:
        return None
    if not isinstance(result, dict) or is_in_band_failure(result) is not None:
        return None
    active = result.get("active_facts")
    if not isinstance(active, list):
        return None
    return [
        str(fact.get("object"))
        for fact in active
        if isinstance(fact, dict)
        and fact.get("predicate") == predicate
        and fact.get("current") is not False
    ]


def main() -> int:
    if len(sys.argv) < 2:
        emit({"ok": False, "error": "usage: kg_supersede.py '<json payload>'"})
        return 2

    try:
        payload = json.loads(sys.argv[1])
    except json.JSONDecodeError as exc:
        emit({"ok": False, "error": f"payload is not valid JSON: {exc}"})
        return 2

    try:
        from mempalace import mcp_server as mcp
    except Exception as exc:  # pragma: no cover - environment problem
        emit({"ok": False, "error": f"cannot import mempalace.mcp_server: {exc}"})
        return 1

    func = getattr(mcp, "tool_kg_supersede", None)
    if func is None:
        emit({
            "ok": False,
            "error": "tool_kg_supersede is absent from the installed python-mempalace; "
                     "upgrade python-mempalace (>= 3.11.0) and retry",
        })
        return 1

    # Guard: the upstream tool does not check that old_object is recorded.
    old_object = str(payload.get("old_object", ""))
    subject = str(payload.get("subject", ""))
    predicate = str(payload.get("predicate", ""))
    if old_object and subject and predicate:
        live = current_objects(mcp, subject, predicate)
        if live is not None and old_object not in live:
            if live:
                message = (
                    f"{subject} has no current {predicate} → {old_object!r}. "
                    f"Currently open: {', '.join(repr(value) for value in live)}. "
                    "Superseding a value that is not recorded does not correct the history — "
                    "it leaves the real value open and adds the new one beside it. "
                    "Retry with one of the values listed above."
                )
            else:
                message = (
                    f"{subject} has no current {predicate} fact at all, so {old_object!r} cannot be superseded. "
                    "If this is a new fact, use kg_add; if the value is recorded differently, "
                    "check it with kg_query."
                )
            emit({"ok": False, "error": message, "details": {"current_objects": live}})
            return 1

    try:
        result = func(**payload)
    except Exception as exc:
        emit({"ok": False, "error": str(exc), "details": traceback.format_exc()})
        return 1

    failure = is_in_band_failure(result)
    if failure is not None:
        emit({"ok": False, "error": failure, "details": result})
        return 1

    emit({"ok": True, "data": result})
    return 0

if __name__ == "__main__":
    sys.exit(main())
