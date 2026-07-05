---
name: mempalace-discovery
description: Palace discovery tools — list_wings, list_rooms, get_taxonomy, get_aaak_spec. Use when exploring what's stored in the palace or needing structural overview.
---

# MemPalace Discovery Tools

## mempalace_list_wings

List all wings with drawer counts. Use to discover what domains are stored.

```
mempalace_list_wings()
→ { wings: { dos_machines: 459, pi: 95, sessions: 252, ... } }
```

## mempalace_list_rooms

List rooms within a wing. Use to navigate within a specific domain.

```
mempalace_list_rooms(wing: "pi")
→ { wing: "pi", rooms: { workflows: 31, problems: 4, milestones: 2, ... } }
```

## mempalace_get_taxonomy

Full taxonomy tree: wing → room → drawer count. Use for complete structural overview.

```
mempalace_get_taxonomy()
→ { taxonomy: { wing_name: { room_name: count, ... }, ... } }
```

## mempalace_get_aaak_spec

Get the AAAK dialect specification — the compressed memory format MemPalace uses. Call this if you need to read or write AAAK-compressed memories.

```
mempalace_get_aaak_spec()
→ { aaak_spec: "AAAK is a compressed memory dialect..." }
```

## Topic wings (auto-classification)

MemPalace has a set of topic-based wings used during mining/ingestion to auto-classify content that doesn't have a project-specific wing:

```json
{
  "topic_wings": ["emotions", "consciousness", "memory", "technical",
                   "identity", "family", "creative"],
  "hall_keywords": {
    "emotions": ["scared", "happy", "sad", "love", "feel", ...],
    "consciousness": ["consciousness", "aware", "soul", "exist", ...],
    "memory": ["memory", "remember", "recall", "palace", ...],
    "technical": ["code", "python", "api", "database", ...],
    "identity": ["identity", "name", "persona", "self", ...],
    "family": ["family", "kids", "children", "mother", ...],
    "creative": ["game", "design", "art", "music", "story", ...]
  }
}
```

These are configured in `~/.mempalace/config.json` and used by the miner to sort content into appropriate wings when no project wing is specified. The `hall_keywords` map drives auto-classification: content mentioning "consciousness" or "aware" gets routed to the `consciousness/` wing.

Topic wings aren't exposed via MCP tools — they're a miner-time classification target. You'll see them appear as wings when `mempalace_list_wings()` shows them with drawer counts.
