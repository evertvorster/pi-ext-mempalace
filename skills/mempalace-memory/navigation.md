---
name: mempalace-navigation
description: Palace navigation and graph tools — traverse, find_tunnels, graph_stats, tunnels, hallways, delete_by_source, sync. Use for cross-domain reasoning, entity co-occurrence discovery, bulk cleanup, and palace-filesystem alignment.
---

# MemPalace Navigation & Graph

MemPalace builds a navigable graph from the palace structure:
- **Nodes** = rooms (named ideas)
- **Edges** = shared rooms across wings (implicit tunnels)
- **Explicit tunnels** = agent-created cross-wing links
- **Hallways** = auto-detected entity co-occurrence links within a wing

## Graph overview

```
WINGS → ROOMS → DRAWERS
                 ↓
            ENTITIES (auto-detected from content)
                 ↓
            HALLWAYS — within-wing entity→entity links
                 ↓
            TUNNELS — cross-wing (implicit via shared rooms
                      or explicit via agent-created links)
```

## Implicit vs. explicit tunnels

| Type | Created by | How |
|---|---|---|
| Implicit | MemPalace | Rooms with the same name appearing in multiple wings |
| Explicit | Agent | `create_tunnel` links specific locations across wings |

## Hallways (entity co-occurrence)

A **hallway** is an auto-detected connection between two entities (people, projects, concepts — anything the entity detector finds) that co-occur across drawers within a single wing. They are the "within-wing" complement to tunnels (which connect rooms across wings).

For example: if "Pi" and "MemPalace" appear together in 47 drawers across the decisions, problems, and project-facts rooms of the `pi/` wing, there's a hallway between them. Hallways represent *who/what relates to whom/what*, not *which rooms relate to which*.

| Feature | Hallways | Tunnels |
|---|---|---|
| Scope | Within one wing | Across two wings |
| Unit | Entities (concepts, people, topics) | Rooms (named ideas) |
| Creation | Auto-detected from co-occurrence | Agent-created explicitly |
| Persistence | `hallways.json` | `tunnels.json` |
| Use case | Discovery — "what travels together?" | Connection — "these rooms are related" |

### mempalace_list_hallways

List auto-detected hallways, optionally filtered by wing.

```
mempalace_list_hallways(wing: "project_api")  // optional
→ [{ id, wing, entity_a, entity_b, co_occurrence_count, rooms: [...], strength }]
```

### mempalace_delete_hallway

Delete a hallway by its ID. Rarely needed — mostly if an entity pair is incorrectly linked.

```
mempalace_delete_hallway(hallway_id: "hallway_abc123")
```

## Bulk operations

### mempalace_delete_by_source

Delete every drawer whose `source_file` metadata matches exactly. Defaults to dry-run (reports blast radius without deleting). Useful for cleaning up after contaminated imports (e.g., benchmark/eval files mined into a project wing) or deleted transcript files.

```
mempalace_delete_by_source(
  source_file: "/path/to/contaminated-file.jsonl",
  dry_run: true   // optional — default true; pass false to commit (irreversible)
)
→ { success, dry_run, match_count, sample: [{ wing, room }], ... }
```

Always run with `dry_run` (the default) first to see the blast radius. The response includes a `sample` of (wing, room) pairs where matches were found.

### mempalace_sync

Prune drawers whose source files are gitignored, missing, or moved. Defaults to dry-run. Keeps the palace aligned with the filesystem — useful after repo restructures, deleting transcript files, or moving projects.

```
mempalace_sync(
  project_dir: "/path/to/project",  // optional — all projects if omitted
  wing: "project_api",              // optional — restrict to a wing
  apply: false                       // optional — default false; pass true to commit
)
→ { success, pruned_drawers, ... }
```

Always run with `apply` omitted or `false` first to preview the impact.

## mempalace_traverse

Walk the palace graph from a room. Shows connected ideas across wings via BFS traversal.

```
mempalace_traverse(
  start_room: "chromadb-setup",
  max_hops: 2     // optional — default 2, max 10
)
→ [{ room, wings: [...], halls: [...], count, hop, connected_via: [...] }]
```

**Use when:** "What's related to chromadb-setup?" — start from that room and follow connections.

## mempalace_find_tunnels

Find rooms that bridge two wings — the hallways connecting different domains.

```
mempalace_find_tunnels(
  wing_a: "wing_code",     // optional — omit to search all pairs
  wing_b: "wing_team"      // optional
)
→ [{ room, wings: [...], halls: [...], count, recent: "2026-05-01" }]
```

**Use when:** "What connects wing_code and wing_team?" or "What topics appear in multiple wings?"

## mempalace_graph_stats

Palace graph overview: total rooms, tunnel connections, edges between wings.

```
mempalace_graph_stats()
→ { total_rooms, tunnel_rooms, total_edges, rooms_per_wing: {}, top_tunnels: [...] }
```

## Tunnel CRUD

### mempalace_create_tunnel
Create an explicit cross-wing tunnel linking two palace locations. Use when content in one project relates to another.

```
mempalace_create_tunnel(
  source_wing: "project_api", source_room: "decisions",
  target_wing: "project_db", target_room: "schema",
  label: "API decisions reference DB schema",  // optional
  source_drawer_id: "...", target_drawer_id: "..."  // optional
)
```

### mempalace_list_tunnels
List all explicit cross-wing tunnels. Optionally filter by wing.

```
mempalace_list_tunnels(wing: "project_api")  // optional
```

### mempalace_delete_tunnel
Delete an explicit tunnel by ID.

```
mempalace_delete_tunnel(tunnel_id: "abc123")
```

### mempalace_follow_tunnels
Follow tunnels from a room to see what it connects to in other wings. Returns connected rooms with drawer previews.

```
mempalace_follow_tunnels(wing: "project_api", room: "decisions")
→ [{ direction, connected_wing, connected_room, label, drawer_preview }]
```
