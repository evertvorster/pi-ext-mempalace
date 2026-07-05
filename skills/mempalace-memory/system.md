---
name: mempalace-system
description: Palace system tools — reconnect, hook_settings, memories_filed_away. Use for palace health, checkpoint status, and hook configuration.
---

# MemPalace System Tools

## mempalace_reconnect

Force reconnect to the palace database. Use after external scripts or CLI commands modified the palace directly, which can leave the in-memory HNSW index stale.

```
mempalace_reconnect()
→ { success: true, message: "Reconnected to palace", drawers: 2249, vector_disabled: false }
```

## mempalace_hook_settings

Get or set hook behavior settings.

```
mempalace_hook_settings(silent_save: true, desktop_toast: false)
→ { success: true, settings: { silent_save: true, desktop_toast: false }, updated: ["silent_save → true"] }
```

**Settings:**
- `silent_save`: True = save directly (no MCP clutter), False = legacy blocking
- `desktop_toast`: True = show desktop notification via notify-send

## mempalace_memories_filed_away

Check whether the last checkpoint was saved. Returns message count and timestamp.

```
mempalace_memories_filed_away()
→ { status: "ok"|"quiet"|"error", message: "3 messages tucked into drawers", count: 3, timestamp: "..." }
```
