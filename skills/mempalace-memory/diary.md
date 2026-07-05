---
name: mempalace-diary
description: Agent diary operations — diary_write, diary_read. Use when recording agent observations, thoughts, or reflecting on past sessions.
---

# MemPalace Agent Diary

Each agent has its own diary wing. Diary entries are timestamped and accumulate over time — it's the agent's personal journal across sessions.

## mempalace_diary_write

Write a diary entry for this agent. Write in AAAK format for compression — entity codes, emotion markers, pipe-separated structure.

```
mempalace_diary_write(
  agent_name: "pi",           // required — your agent identity
  entry: "SESSION:2026-05-08|built.mempalace.tools|★★★",  // required
  topic: "extension-design",  // optional — default "general"
  wing: "pi"                  // optional — target wing; defaults to wing_{agent_name}
)
```

**Diary content should include:**
- What was worked on this session
- Key observations and insights
- Things to remember for next session
- Emotional context (excitement, frustration, concerns)

## mempalace_diary_read

Read your recent diary entries. See what past versions of yourself recorded — your journal across sessions.

```
mempalace_diary_read(
  agent_name: "pi",       // required
  last_n: 10,             // optional — default 10
  wing: "pi"              // optional — specific wing to read from
)
→ { agent, entries: [{ date, timestamp, topic, content }], total, showing }
```

## Memory Protocol rule #4

> AFTER EACH SESSION: call `mempalace_diary_write` to record what happened, what you learned, what matters.
