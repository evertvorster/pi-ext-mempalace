#!/usr/bin/env python3
"""Compose the session-start wake-up block.

Why this exists instead of `mempalace wake-up`: that command renders L0 + L1,
where L1 is the fifteen most recently *filed* drawers in one wing. Chunked
documents count as drawers and nothing filters by room, so on this palace it
spent the whole budget on three diary entries cut into fifteen mid-sentence
fragments, a duplicated identity preamble (L0 is re-rendered per wing), and raw
transcript JSON that happened to contain the previous wake-up — the block was
quoting itself. `python-mempalace` is third-party, so the composition lives
here.

The design (dora/identity, 2026-11-02) is four slots, in this order, each
trimmed from the tail when the budget runs out:

    identity   ~/.mempalace/identity.txt, rendered once, never per wing
    where      cwd, the wings being read, and how much is in them
    open       open / in_progress / blocked loops in those wings, with next_action
    core       the curated rooms in the identity wing, claimed by room not recency
    pointers   where to dig next

There is deliberately no "last session" slot (2026-11-02, later the same day).
Sessions run until the context fills, so one file holds several unrelated topics
and its newest diary checkpoint is the *tail* of it — the least representative
part, rendered as if it were a summary. What survives a session is the open
loops and the decisions; the narrative is in `diary`, reachable by search, and
where to find it is instructions (`AGENTS.md`), not state.

Never rendered: the `transcripts` room, turn checkpoints, chunk_index > 0, and
anything that looks like a previous wake-up or a raw session record.

Payload (argv[1], JSON):
    cwd              required — shown in the wake-up and used for the header
    wings            required — the project wings this cwd resolved to
    identity_wing    optional, default "dora"
    core_rooms       optional, default the curated set below, as [[room, n], ...]
    min_chars, max_chars   optional budget for the whole block

Writes the result to $KG_WAKE_OUTPUT as JSON, because importing
mempalace.mcp_server redirects fd 1 to stderr (see kg_supersede.py).
"""
from __future__ import annotations

import json
import os
import re
import sys
import traceback

# Rooms in the identity wing that make up the curated core, in render order, with
# how many drawers each may claim. Everything else in that wing is either diary
# or project matter that belongs elsewhere.
DEFAULT_CORE = [
    ["identity", 1],
    ["mind", 3],
    ["workflows", 2],
    ["decisions", 2],
    ["projects", 1],
]

# Rooms that never belong in a wake-up, whatever their filed_at says.
EXCLUDED_ROOMS = {"transcripts"}

# Markers that mean "this is a previous wake-up or a raw session record", not memory.
EXCLUDED_MARKERS = ("[MemPalace Wake-Up Context", '{"type":"session"', '{"type": "session"')

MAX_CHARS_DEFAULT = 6000
MIN_CHARS_DEFAULT = 1200
OPEN_SLOTS = None  # no cap; see open_slots
SNIPPET = 320
CORE_SNIPPET = 200
OPEN_SNIPPET = 220


def emit(payload: dict) -> None:
    text = json.dumps(payload)
    out = os.environ.get("KG_WAKE_OUTPUT")
    if out:
        try:
            with open(out, "w", encoding="utf-8") as handle:
                handle.write(text + "\n")
        except OSError:
            pass
    print(text, flush=True)


def field(doc: str, name: str) -> str:
    """One `name: value` line from a drawer's header block."""
    match = re.search(rf"^{name}:\s*(.+)$", doc or "", re.MULTILINE)
    return match.group(1).strip() if match else ""


TOMBSTONE_PREFIXES = ("SUPERSEDED", "CLOSED", "SOLVED", "DONE", "RESOLVED")


def is_tombstone(doc: str) -> bool:
    """Closed history is worth keeping in the palace and worth nothing in a wake-up.

    Superseding leaves the old drawer in place with `superseded:` and a summary that
    says so — that is the record. Rendering it would spend a slot on a statement
    whose only content is that it is no longer true.
    """
    if field(doc, "superseded"):
        return True
    # Not every tombstone carries a header: some are a rewritten body whose first
    # line is the verdict, so check the body head as well as the summary field.
    head = (field(doc, "summary") or doc or "").lstrip("-— ").strip().upper()
    return any(head.startswith(prefix) for prefix in TOMBSTONE_PREFIXES)


def sentences(text: str, count: int) -> str:
    """The first `count` sentences, cut at a boundary rather than mid-word."""
    flat = " ".join((text or "").split())
    if not flat:
        return ""
    parts = re.split(r"(?<=[.!?])\s+", flat)
    out = " ".join(parts[:count]).strip()
    if len(out) > SNIPPET:
        cut = out[:SNIPPET]
        stop = max(cut.rfind(". "), cut.rfind("; "), cut.rfind(", "))
        out = (cut[:stop] if stop > 60 else cut).rstrip(" ,;") + " …"
    return out


def open_for_read():
    from mempalace.config import MempalaceConfig
    from mempalace.palace import get_collection

    return get_collection(MempalaceConfig().palace_path, create=False, read_only=True)


def fetch(col, wing: str, room: str, limit: int = 400) -> list:
    """Drawers in one wing/room as [(doc, meta)], chunk 0 only, newest first.

    `get` rather than `query`: no embedding, no similarity, just rows. The where
    filter is built by the package's own helper so the metadata keys stay right.
    """
    from mempalace.searcher import build_where_filter

    where = build_where_filter(wing, room)
    try:
        result = col.get(where=where, limit=limit, include=["documents", "metadatas"])
    except Exception:
        return []
    docs = result.get("documents") or []
    metas = result.get("metadatas") or []

    rows, seen = [], set()
    for doc, meta in zip(docs, metas):
        meta = meta or {}
        if meta.get("room") in EXCLUDED_ROOMS:
            continue
        chunk = meta.get("chunk_index")
        if chunk is not None and int(chunk) != 0:
            continue
        text = doc or ""
        if any(marker in text[:200] for marker in EXCLUDED_MARKERS):
            continue
        parent = meta.get("parent_drawer_id") or meta.get("drawer_id") or text[:80]
        if parent in seen:
            continue
        seen.add(parent)
        rows.append((text, meta))

    rows.sort(key=lambda row: str(row[1].get("filed_at") or ""), reverse=True)
    return rows


def identity_block() -> str:
    path = os.path.expanduser("~/.mempalace/identity.txt")
    try:
        with open(path, "r", encoding="utf-8") as handle:
            return handle.read().strip()
    except OSError:
        return "## L0 — IDENTITY\nNo identity configured."


def open_slots(col, wings: list, slots: int | None = None) -> list:
    """Open work, as `- [wing] summary → next: …` lines.

    No slot count: every loop that is still open is shown, and the character
    budget is what bounds the list — trimmed from the tail, which is the oldest
    loop, because `found` is sorted newest-first. A fixed cap hid the newest
    loops whenever a stale pile happened to sort above them (2026-11-02: the
    cap was 4, and 19 loops from June were never once seen).
    """
    found = []
    for wing in wings:
        for doc, meta in fetch(col, wing, "open-loops"):
            status = field(doc, "status").lower()
            if status not in ("open", "in_progress", "blocked"):
                if status:
                    continue
                if "OPEN" not in (field(doc, "summary") + doc[:200]).upper():
                    continue
            if is_tombstone(doc):
                continue
            summary = field(doc, "summary") or sentences(doc, 1)
            summary = re.sub(r"^(OPEN|IN PROGRESS|BLOCKED):\s*", "", summary, flags=re.I)
            date = field(doc, "date") or str(meta.get("filed_at") or "")[:10]
            next_action = field(doc, "next_action") or field(doc, "nextAction")
            line = f"- [{wing}] {date} {summary}".rstrip()
            if next_action:
                line += f" → {sentences(next_action, 1)}"
            if len(line) > OPEN_SNIPPET:
                cut = line[:OPEN_SNIPPET]
                stop = max(cut.rfind(". "), cut.rfind("; "), cut.rfind(", "))
                line = (cut[:stop] if stop > 80 else cut).rstrip(" ,;") + " …"
            found.append({"filed_at": str(meta.get("filed_at") or ""), "line": line, "wing": wing})
    found.sort(key=lambda row: row["filed_at"], reverse=True)
    return [row["line"] for row in found[:slots]] if slots else [row["line"] for row in found]


def core_block(col, identity_wing: str, core: list) -> list:
    """The curated rooms, newest first within each, in the order given."""
    lines = []
    for room, count in core:
        taken = 0
        for doc, _meta in fetch(col, identity_wing, room):
            if taken >= count:
                break
            if is_tombstone(doc):
                continue
            summary = field(doc, "summary") or sentences(doc, 1)
            if not summary:
                continue
            line = sentences(summary, 1)
            if len(line) > CORE_SNIPPET:
                line = line[:CORE_SNIPPET].rstrip(" ,;") + " …"
            lines.append(f"- [{room}] {line}")
            taken += 1
    return lines


def main() -> int:
    try:
        payload = json.loads(sys.argv[1]) if len(sys.argv) > 1 else {}
    except json.JSONDecodeError as exc:
        emit({"ok": False, "error": f"invalid payload: {exc}"})
        return 1

    cwd = payload.get("cwd") or os.getcwd()
    identity_wing = payload.get("identity_wing") or "dora"
    wings = [w for w in (payload.get("wings") or []) if w]
    if not wings:
        wings = [identity_wing]
    core = payload.get("core_rooms") or DEFAULT_CORE
    max_chars = int(payload.get("max_chars") or MAX_CHARS_DEFAULT)

    try:
        col = open_for_read()
    except Exception as exc:
        emit(
            {
                "ok": True,
                "data": {
                    "text": identity_block() + f"\n\n## Memory unavailable\n{str(exc).splitlines()[0]}",
                    "degraded": True,
                },
            }
        )
        return 0

    try:
        # Sections in priority order: when the budget is short, lines come off the end of
        # the lowest-priority section, and no section disappears while a cheaper trim exists.
        sections: list[list[str]] = []

        where_line = f"cwd: {cwd} · wings: {', '.join(wings)}"
        sections.append([where_line])

        try:
            opened = open_slots(col, wings)
        except Exception:
            opened = []
        if opened:
            sections.append(opened)

        # Durable core last: when the budget bites, its tail comes off first, and the
        # open loops — the actionable part — are the more expensive thing to lose.
        try:
            core_lines = core_block(col, identity_wing, core)
        except Exception:
            core_lines = []
        if core_lines:
            sections.append(core_lines)

        titles = ["## Where I am", "## Still open", "## Core"]
        titles = titles[: len(sections)]

        def render() -> str:
            blocks = [identity_block().strip()]
            for title, lines in zip(titles, sections):
                if lines:
                    blocks.append(title + "\n" + "\n".join(lines))
            blocks.append(
                "## Pointers\n"
                "Deeper: `mempalace search`/`ask` · manage: `/mempalace` · skills: mempalace-memory.\n"
                "No clock or context gauge is in the prompt — `status` prints both. "
                "Run it before a large read, or when the work starts to feel heavy."
            )
            return "\n\n".join(blocks).strip()

        text = render()
        # Drop one line at a time from the lowest-priority section still holding any.
        while len(text) > max_chars:
            for section in reversed(sections):
                if len(section) > 1:
                    section.pop()
                    break
            else:
                break
            text = render()

        emit(
            {
                "ok": True,
                "data": {
                    "text": text,
                    "chars": len(text),
                    "approx_tokens": len(text) // 4,
                    "slots": {
                        "open": len(opened),
                        "core": len(core_lines),
                    },
                },
            }
        )
        return 0
    except Exception:
        emit({"ok": False, "error": traceback.format_exc(limit=3)})
        return 1


if __name__ == "__main__":
    sys.exit(main())
