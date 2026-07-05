# pi-ext-mempalace

MemPalace durable memory integration for the [pi coding agent](https://github.com/mariozechner/pi-coding-agent).

This extension bridges pi's tool system to [MemPalace](https://github.com/mempalace/mempalace), a local-first AI memory system. It provides 37 pi tools covering structured memories, knowledge graph operations, cross-wing navigation, agent diary, and session hooks.

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

**37 pi tools:**

| Category | Tools |
|---|---|
| **Core** | status, search, remember, check_duplicate, open_loops, add_drawer, mine_project, wake_up |
| **Drawer CRUD** | get_drawer, list_drawers, update_drawer, delete_drawer |
| **Knowledge Graph** | kg_query, kg_add, kg_invalidate, kg_timeline, kg_stats |
| **Navigation** | traverse, find_tunnels, graph_stats, create_tunnel, list_tunnels, delete_tunnel, follow_tunnels, list_hallways, delete_hallway |
| **Bulk ops** | delete_by_source, sync |
| **Diary** | diary_write, diary_read |
| **System** | reconnect, hook_settings, memories_filed_away |

**6 maintenance commands:** mempalace-repair, mempalace-compress, mempalace-split, mempalace-sweep, mempalace-migrate

**8 skill files** for the LLM to reference during use.

## Session hooks

The extension registers lifecycle hooks that automatically save session context:

- **Session start** — loads identity and project context from MemPalace
- **Every ~15 turns** — partial transcript checkpoint to `{wing}/transcripts/`
- **Before context compaction** — final transcript save

## License

MIT
