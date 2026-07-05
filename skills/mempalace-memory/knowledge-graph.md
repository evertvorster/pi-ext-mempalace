---
name: mempalace-knowledge-graph
description: Knowledge graph operations — kg_query, kg_add, kg_invalidate, kg_timeline, kg_stats. Use when working with entity relationships, temporal facts, or entity tracking.
---

# MemPalace Knowledge Graph

The knowledge graph stores typed entity relationships with temporal validity. It complements drawer storage (verbatim text) with structured facts.

## Protocol rule #5

> WHEN FACTS CHANGE: call `mempalace_kg_invalidate` on the old fact, `mempalace_kg_add` for the new one.

## mempalace_kg_query

Query the knowledge graph for an entity's relationships. Returns typed facts with temporal validity. Use as alternative to `mempalace_search` for relationship-based lookups.

```
mempalace_kg_query(
  entity: "Max",
  as_of: "2026-01-15",    // optional — date filter, see facts valid at that time
  direction: "both"        // optional — outgoing|incoming|both (default)
)
→ { entity, as_of, facts: [{ subject, predicate, object, valid_from, valid_to, current }], count }
```

**Example:** "What facts do you know about Max?" → `kg_query(entity="Max", direction="both")`

## mempalace_kg_add

Add a fact to the knowledge graph. Subject → predicate → object with optional time window.

```
mempalace_kg_add(
  subject: "Max",
  predicate: "loves",
  object: "chess",
  valid_from: "2025-10-01",    // optional
  source_closet: "..."         // optional
)
→ { success, triple_id, fact: "Max → loves → chess" }
```

## mempalace_kg_invalidate

Mark a fact as no longer true (set end date). Use when a relationship changed — e.g., a job ended, an injury resolved, a preference changed.

```
mempalace_kg_invalidate(
  subject: "Max",
  predicate: "has_issue",
  object: "sports_injury",
  ended: "2026-02-15"   // optional — default today
)
```

## mempalace_kg_timeline

Get chronological timeline of facts, optionally filtered by entity. Shows the story of an entity (or everything) in order.

```
mempalace_kg_timeline(entity: "Max")
→ { entity, timeline: [{ subject, predicate, object, valid_from, valid_to, current }], count }
```

## mempalace_kg_stats

Knowledge graph overview: entities, triples, current vs expired facts, relationship types.

```
mempalace_kg_stats()
→ { entities, triples, current_facts, expired_facts, relationship_types: [...] }
```
