#!/usr/bin/env python3
"""
Clean up MemPalace rooms that were polluted by auto-capture hooks.

The hooks (before the fix) used `mempalace mine --mode convos` which
auto-classified session transcripts into rooms like "technical" and
"architecture" based on content heuristics. This script moves those
raw session dumps into a dedicated `transcripts` room within each wing.

Usage:
    python cleanup_rooms.py          # dry-run (preview only)
    python cleanup_rooms.py --apply  # actually move drawers
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# Add mempalace to path if needed
sys.path.insert(0, str(Path.home() / ".local" / "lib" / "python3.11" / "site-packages"))

# Rooms known to be polluted with raw session JSONL from auto-capture hooks
POLLUTED_ROOMS = {
    "pi":     ["architecture", "technical", "planning"],
    "sessions": ["architecture", "technical", "planning", "problems"],
}

MIN_SESSION_JSONL_LENGTH = 200


def is_session_jsonl_dump(content: str) -> bool:
    """Check if content looks like a raw pi session transcript dump."""
    if len(content) < MIN_SESSION_JSONL_LENGTH:
        return False
    stripped = content.lstrip()
    # Pi session files are JSONL with type markers
    if stripped.startswith('{"type":"session"'):
        return True
    if stripped.startswith('{"type":"message"'):
        return True
    if stripped.startswith('{"type":"model_change"'):
        return True
    if stripped.startswith('{"type":"compaction"'):
        return True
    # Multiple JSON lines (JSONL format)
    lines = stripped.split("\n")
    jsonl_count = 0
    for line in lines[:10]:
        line = line.strip()
        if line.startswith("{") and ('"type":' in line or '"role":' in line):
            jsonl_count += 1
    if jsonl_count >= 3:
        return True
    return False


def main() -> None:
    parser = argparse.ArgumentParser(description="Clean up polluted MemPalace rooms")
    parser.add_argument("--apply", action="store_true", help="Actually move drawers (default: dry-run)")
    args = parser.parse_args()

    try:
        from mempalace import mcp_server as m
    except ImportError:
        print("ERROR: Could not import mempalace. Make sure it's installed.", file=sys.stderr)
        sys.exit(1)

    total_moved = 0
    total_skipped = 0
    total_checked = 0

    for wing, rooms in POLLUTED_ROOMS.items():
        for room in rooms:
            offset = 0
            limit = 50
            while True:
                try:
                    result = m.tool_list_drawers(wing=wing, room=room, limit=limit, offset=offset)
                except Exception as e:
                    print(f"  Error listing {wing}/{room} (offset={offset}): {e}", file=sys.stderr)
                    break

                drawers = result.get("drawers", []) if isinstance(result, dict) else result
                if not drawers:
                    break

                for drawer in drawers:
                    total_checked += 1
                    drawer_id = drawer.get("drawer_id", "?")
                    preview = drawer.get("content_preview", "")

                    if is_session_jsonl_dump(preview):
                        if args.apply:
                            try:
                                m.tool_update_drawer(drawer_id=drawer_id, room="transcripts")
                                print(f"  MOVED {wing}/{room} → {wing}/transcripts  [{drawer_id[:20]}...]")
                                total_moved += 1
                            except Exception as e:
                                print(f"  ERROR moving {drawer_id}: {e}", file=sys.stderr)
                                total_skipped += 1
                        else:
                            print(f"  [DRY-RUN] Would move {wing}/{room} → {wing}/transcripts  [{drawer_id[:20]}...]")
                            total_moved += 1
                    else:
                        total_skipped += 1
                        if len(preview) > 50:
                            print(f"  KEPT {wing}/{room} (not a session dump) [{preview[:60]}...]")

                offset += limit

            print(f"  {wing}/{room}: checked, done")

    print(f"\n{'='*60}")
    print(f"Total checked: {total_checked}")
    print(f"Total {'moved' if args.apply else 'would move'}: {total_moved}")
    print(f"Total skipped (structured memories): {total_skipped - (total_checked - total_moved - total_skipped) if total_checked - total_moved - total_skipped > 0 else total_skipped}")
    print(f"Mode: {'APPLIED' if args.apply else 'DRY-RUN'}  (use --apply to execute)")


if __name__ == "__main__":
    main()
