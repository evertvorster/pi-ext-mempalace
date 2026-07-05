#!/usr/bin/env python3
"""JSON bridge from pi extension to MemPalace's Python/MCP tool functions.

Phase 1 — thin proxy:
  - Hand-written dispatch is replaced by a TOOL_MAP lookup table.
  - All 29 MCP tools are available by adding one mapping entry.
  - hook_checkpoint and hook_precompact remain as special-case handlers
    because they invoke hooks_cli helpers, not MCP tool functions.
  - All llama.cpp JSON corruption resilience code is preserved.

Adding a new tool: just add a line to TOOL_MAP.
Example:    "diary_write": "tool_diary_write",
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import traceback


# ---------------------------------------------------------------------------
# TOOL_MAP — command name → MCP tool function name
# ---------------------------------------------------------------------------
# Every entry maps a bridge command to the corresponding mcp_server
# tool function.  Parameters are forwarded as-is from the payload dict.
# When a new MCP tool is added, add a mapping line here.
# ---------------------------------------------------------------------------

TOOL_MAP = {
    # Palace reads
    "status":        "tool_status",
    "list_wings":    "tool_list_wings",
    "list_rooms":    "tool_list_rooms",
    "get_taxonomy":  "tool_get_taxonomy",
    "search":        "tool_search",
    "check_duplicate": "tool_check_duplicate",
    "get_aaak_spec": "tool_get_aaak_spec",
    # Drawer management
    "add_drawer":    "tool_add_drawer",
    "delete_drawer": "tool_delete_drawer",
    "get_drawer":    "tool_get_drawer",
    "list_drawers":  "tool_list_drawers",
    "update_drawer": "tool_update_drawer",
    # Knowledge graph
    "kg_add":        "tool_kg_add",
    "kg_query":      "tool_kg_query",
    "kg_invalidate": "tool_kg_invalidate",
    "kg_timeline":   "tool_kg_timeline",
    "kg_stats":      "tool_kg_stats",
    # Hallways (auto-detected entity co-occurrence)
    "list_hallways":  "tool_list_hallways",
    "delete_hallway": "tool_delete_hallway",
    # Graph navigation
    "traverse":      "tool_traverse_graph",
    "find_tunnels":  "tool_find_tunnels",
    "graph_stats":   "tool_graph_stats",
    "create_tunnel": "tool_create_tunnel",
    "list_tunnels":  "tool_list_tunnels",
    "delete_tunnel": "tool_delete_tunnel",
    "follow_tunnels": "tool_follow_tunnels",
    # Agent diary
    "diary_write":   "tool_diary_write",
    "diary_read":    "tool_diary_read",
    # System
    "hook_settings": "tool_hook_settings",
    "memories_filed_away": "tool_memories_filed_away",
    "reconnect":     "tool_reconnect",
    # Bulk / sync
    "delete_by_source": "tool_delete_by_source",
    "sync":           "tool_sync",
}


# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------

def _json_default(value):
    try:
        import numpy as np  # type: ignore

        if isinstance(value, np.generic):
            return value.item()
        if isinstance(value, np.ndarray):
            return value.tolist()
    except Exception:
        pass
    return str(value)


# ---------------------------------------------------------------------------
# llama.cpp JSON corruption resilience
# ---------------------------------------------------------------------------
# llama-server has known bugs (#20359, Hermes-Agent #12068) that corrupt
# JSON in tool-call arguments.  This repair routine attempts to fix the
# most common patterns so the bridge can parse the payload and return
# a meaningful error instead of a raw 500.
# ---------------------------------------------------------------------------

def _repair_json(raw: str) -> str:
    """Best-effort repair of llama.cpp-corrupted JSON strings."""
    if not raw:
        return raw

    # 1. Normalise over-escaped quotes: \\\" → \\" (one level)
    while r'\"' in raw:
        raw = raw.replace(r'\"', '"')

    # 2. Try parsing again after over-escape fix
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, ValueError):
        pass

    # 3. Replace single-quoted string values inside JSON with double-quoted.
    repaired = []
    i = 0
    while i < len(raw):
        if raw[i] == '"':
            j = i + 1
            while j < len(raw) and raw[j] != '"':
                if raw[j] == '\\' and j + 1 < len(raw):
                    j += 2
                else:
                    j += 1
            repaired.append(raw[i:j + 1])
            i = j + 1
        elif raw[i] == "'":
            j = i + 1
            while j < len(raw) and raw[j] != "'":
                j += 1
            inner = raw[i + 1:j]
            inner = inner.replace('\\', '\\\\').replace('"', '\\"')
            repaired.append('"' + inner + '"')
            i = j + 1
        else:
            repaired.append(raw[i])
            i += 1

    repaired_str = ''.join(repaired)
    try:
        json.loads(repaired_str)
        return repaired_str
    except (json.JSONDecodeError, ValueError):
        return raw


def _parse_payload(payload_str: str) -> dict:
    """Parse JSON payload with llama.cpp corruption resilience."""
    try:
        return json.loads(payload_str)
    except (json.JSONDecodeError, ValueError):
        repaired = _repair_json(payload_str)
        if repaired != payload_str:
            try:
                return json.loads(repaired)
            except (json.JSONDecodeError, ValueError):
                pass
        return {"_raw": payload_str, "_parse_error": True}


# ---------------------------------------------------------------------------
# Post-parse cleanup: strip over-escaped quotes from string values
# ---------------------------------------------------------------------------

def _clean_string_value(s):
    """Strip over-escaped quotes from a string value."""
    if not isinstance(s, str):
        return s

    if len(s) >= 3 and s[0] == '"' and s[-1] == '"':
        inner = s[1:-1]
        if inner and '\\' not in inner and '"' not in inner:
            return inner

    return s


def _clean_payload(data: dict) -> dict:
    """Recursively clean over-escaped quotes from string values in payload."""
    if isinstance(data, dict):
        return {k: _clean_payload(v) for k, v in data.items()}
    if isinstance(data, list):
        return [_clean_payload(item) for item in data]
    if isinstance(data, str):
        return _clean_string_value(data)
    return data


def emit(payload):
    """Emit JSON response to stdout and optional output file."""
    text = json.dumps(payload, default=_json_default)
    out_path = os.environ.get("MEMPALACE_BRIDGE_OUTPUT")
    if out_path:
        with open(out_path, "w", encoding="utf-8") as handle:
            handle.write(text)
            handle.write("\n")
    print(text, flush=True)


def ok(data):
    emit({"ok": True, "data": data})


def fail(message: str, details=None, code: int = 1):
    emit({"ok": False, "error": message, "details": details})
    raise SystemExit(code)


# ---------------------------------------------------------------------------
# Special-case handlers (not MCP tool functions)
# ---------------------------------------------------------------------------

def _ingest_transcript_for_wing(transcript_path: str, wing: str) -> None:
    """File a pi session transcript into {wing}/transcripts as a single verbatim drawer.

    Unlike mempalace mine --mode convos (which auto-classifies transcripts into
    rooms like 'technical' or 'architecture' based on content heuristics), this
    stores the transcript verbatim in a dedicated transcripts room. This keeps
    auto-captured session noise isolated from structured memories filed via
    mempalace_remember.
    """
    if not transcript_path:
        return

    from pathlib import Path
    from mempalace import mcp_server as m

    path = Path(transcript_path).expanduser()
    if not path.is_file() or path.stat().st_size < 100:
        return

    try:
        content = path.read_text("utf-8", errors="replace")
    except OSError:
        return

    # Truncate very large transcripts to keep storage reasonable
    max_chars = 50000
    if len(content) > max_chars:
        content = content[:max_chars] + f"\n\n[... truncated at {max_chars} characters]"

    target_wing = str(wing or "pi").strip() or "pi"
    try:
        m.tool_add_drawer(
            wing=target_wing,
            room="transcripts",
            content=content,
            source_file=str(path),
            added_by="pi-hook",
        )
    except Exception:
        pass


def handle_hook_checkpoint(payload: dict) -> dict:
    """Special handler for hook_checkpoint — calls hooks_cli directly."""
    from mempalace import hooks_cli as h

    transcript_path = payload.get("transcript_path") or ""
    session_id = payload.get("session_id") or "pi-session"
    wing = payload.get("wing") or ""
    result = h._save_diary_direct(transcript_path, session_id, wing=wing, toast=False, agent_name="pi")
    if transcript_path:
        _ingest_transcript_for_wing(transcript_path, wing or "pi")
    return result


def handle_hook_precompact(payload: dict) -> dict:
    """Special handler for hook_precompact — calls hooks_cli directly."""
    from mempalace import hooks_cli as h

    transcript_path = payload.get("transcript_path") or ""
    wing = payload.get("wing") or "pi"
    if transcript_path:
        _ingest_transcript_for_wing(transcript_path, wing)
    return {"success": True, "transcript_path": transcript_path, "wing": wing}


# ---------------------------------------------------------------------------
# Main dispatch
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("command")
    parser.add_argument("payload", nargs="?", default="{}")
    args = parser.parse_args()

    payload = _parse_payload(args.payload)
    if payload.get("_parse_error"):
        fail(f"llama.cpp may have corrupted the JSON payload (known bug). Raw: {payload.get('_raw', '')[:200]}")

    # Clean up over-escaped quotes from llama.cpp corruption (#20359,
    # Hermes-Agent #12068).  Opt-in via MEMPALACE_BRIDGE_FIX_LAMACPP=1.
    if os.environ.get("MEMPALACE_BRIDGE_FIX_LAMACPP"):
        payload = _clean_payload(payload)

    try:
        # --- Special-case hooks (not MCP tool functions) ---
        if args.command == "hook_checkpoint":
            ok(handle_hook_checkpoint(payload))
            return
        if args.command == "hook_precompact":
            ok(handle_hook_precompact(payload))
            return

        # --- Generic MCP tool dispatch via TOOL_MAP ---
        func_name = TOOL_MAP.get(args.command)
        if func_name is None:
            fail(f"Unknown command: {args.command}")

        from mempalace import mcp_server as m
        tool_func = getattr(m, func_name, None)
        if tool_func is None:
            fail(f"MCP tool function '{func_name}' not found in mcp_server")

        result = tool_func(**payload)
        ok(result)

    except SystemExit:
        raise
    except Exception as exc:
        fail(str(exc), traceback.format_exc())


if __name__ == "__main__":
    main()
