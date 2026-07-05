---
name: mempalace-drawer-crud
description: Drawer CRUD operations — get_drawer, list_drawers, update_drawer, delete_drawer. Use when browsing, correcting, or removing stored memories.
---

# MemPalace Drawer CRUD

## mempalace_get_drawer

Fetch a single drawer by ID — returns full content and metadata. Use to verify memory content before citing, or to inspect a drawer found via search.

```
mempalace_get_drawer(drawer_id: "drawer_pi_decisions_abc123")
→ { drawer_id, content, wing, room, metadata: { ..., filed_at, added_by, source_file } }
```

## mempalace_list_drawers

List drawers with pagination. Optional wing/room filter. Returns IDs, wings, rooms, and content previews.

```
mempalace_list_drawers(
  wing: "pi",          // optional filter
  room: "workflows",   // optional filter
  limit: 20,           // optional — default 20
  offset: 0,           // optional — default 0
)
→ { drawers: [{ drawer_id, wing, room, content_preview }], count, offset, limit }
```

## mempalace_update_drawer

Update an existing drawer's content and/or metadata (wing, room). Fetches existing drawer first; returns error if not found. Use to correct mistakes without creating duplicates.

```
mempalace_update_drawer(
  drawer_id: "drawer_pi_decisions_abc123",
  content: "updated text",      // optional — omit to keep existing
  wing: "new_wing",             // optional — omit to keep existing
  room: "new_room",             // optional — omit to keep existing
)
```

## mempalace_delete_drawer

Delete a single drawer by ID. Irreversible. Use when a memory is bad, wrong, or no longer relevant.

```
mempalace_delete_drawer(drawer_id: "drawer_pi_decisions_abc123")
```
