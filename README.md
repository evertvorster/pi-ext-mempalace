# pi-ext-mempalace

MemPalace durable memory integration for the [pi coding agent](https://github.com/mariozechner/pi-coding-agent).

This extension bridges pi's tool system to [MemPalace](https://github.com/mempalace/mempalace), a local-first AI memory system. It provides 40 pi tools covering structured memories, knowledge graph operations, cross-wing navigation, agent diary, and session hooks.

## Requirements

- [pi-coding-agent](https://aur.archlinux.org/packages/pi-coding-agent)
- [python-mempalace](https://aur.archlinux.org/packages/python-mempalace) (the MemPalace Python library with MCP server)

## Installation

### From AUR

```bash
yay -S pi-ext-mempalace
```

Then add to `~/.pi/agent/settings.json`:

```json
{
  "extensions": ["/usr/share/pi/extensions"]
}
```

Or create a symlink in `extensions-ordered/` for load-order control:

```bash
ln -s /usr/share/pi/extensions/mempalace ~/.pi/agent/extensions-ordered/00-mempalace
```

### From source

```bash
git clone https://github.com/evertvorster/pi-ext-mempalace.git
cd pi-ext-mempalace
npm install
```

Then symlink into pi's extension directory:

```bash
ln -s "$PWD" ~/.pi/agent/extensions-ordered/00-mempalace
```

## What it provides

**40 pi tools:**

| Category | Tools |
|---|---|
| **Core** | status, search, remember, check_duplicate, open_loops, add_drawer, mine_project, wake_up |
| **Drawer CRUD** | get_drawer, list_drawers, update_drawer, delete_drawer |
| **Knowledge Graph** | kg_query, kg_add, kg_invalidate, kg_timeline, kg_stats |
| **Navigation** | traverse, find_tunnels, graph_stats, create_tunnel, list_tunnels, delete_tunnel, follow_tunnels, list_hallways, delete_hallway |
| **Bulk ops** | delete_by_source, sync |
| **Diary** | diary_write, diary_read |
| **System** | reconnect, hook_settings, memories_filed_away |
| **Extras** | fact, ask, maintain |

The three extras exist because a single `mempalace` command cannot express the job:

- **`mempalace_fact`** files one checkable fact as a knowledge-graph triple *and* a project-fact drawer
  in one call. Pass `oldObject` and it supersedes: the old value closes and the new one opens at one
  instant, and it refuses to supersede a value that is not currently recorded — upstream
  `tool_kg_supersede` accepts one and silently leaves two current facts.
- **`mempalace_ask`** answers "what do I have on this?" with evidence, including the absence case: how
  many drawers were searched, how many cleared the similarity line, whether they were knowledge or
  archive, and the nearest miss.
- **`mempalace_maintain`** runs the two palace-wide passes — `task: "orphans"` for drawers whose source
  file is gone (what `sync` reports as `unresolved` and never prunes) and `task: "closets"` to rebuild
  the ranking layer after rooms or drawers move. Both dry-run by default.

## Write-path guard

Names are checked mechanically on every write, through pi's `tool_call` hook: an exact wing, room or
entity passes; a mechanical variant (`project_facts`, `Open_Loops`) is rewritten onto the populated
spelling; a near-miss is refused with a "did you mean"; a genuinely new name is allowed but reported. An
`add_drawer` with neither a `type:` header nor an explicit room is refused.

This exists because the palace accumulated `project-facts` *and* `project_facts` in three wings, and one
person as three entities, and nothing refused any of it.

## Rendering

Results are rendered for reading rather than dumping raw JSON: `kg_query` groups current facts by
predicate with `(+N more)` and counts the ended ones; search dedupes by drawer id, hides hits from the
session doing the searching, labels its 800-character previews, and broadens a weak match across wings
with capture rooms excluded; `open_loops` filters on each drawer's own `status:` field.

**6 maintenance commands:** mempalace-repair, mempalace-compress, mempalace-split, mempalace-sweep, mempalace-migrate

**5 skill files** for the LLM to reference during use, rewritten in 0.2.2 around the questions actually
asked: which store answers which question, the two axes (`type` is the class, `room` is the topic), the
knowledge-graph vocabulary and temporal rules, topics/tunnels/closets, and maintenance discipline.

## Session hooks

The extension registers lifecycle hooks that automatically save session context:

- **Session start** — loads identity and project context from MemPalace
- **Every ~15 turns** — partial transcript checkpoint to `{cwd-wing}/transcripts/`
- **Before context compaction** — final transcript save to `{cwd-wing}/transcripts/`

The capture wing is derived from the session's working directory (nearest
`mempalace.yaml` `wing:`, otherwise the directory name), so each project's
captures sit beside that project's own memories. The `pi/` wing is only for
content about pi itself.

## License

MIT
