# pi-ext-mempalace

MemPalace durable memory integration for the [pi coding agent](https://github.com/mariozechner/pi-coding-agent).

This extension bridges pi's tool system to [MemPalace](https://github.com/mempalace/mempalace), a local-first AI memory system. It provides two tools: `mempalace`, always available and cheap, for recall; and `mempalace_manage`, deferred, for writing and organising. Between them, 36 commands.

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

**Two tools, two surfaces.** Forty separate tools cost their schemas on every request — about 7 000 tokens
before a single call — and made a decision out of every call. Reading is what a session does constantly;
writing is something you sit down to do.

| tool | commands | declared | cost |
|---|---|---|---|
| `mempalace` | `ask`, `search`, `open_loops`, `get_drawer`, `list_drawers` | always | ~240 tokens/request |
| `mempalace_manage` | 31: `remember`, `fact`, `add/update/delete_drawer`, `kg_*`, `taxonomy`, tunnels, `orphans`, `closets`, `sync`, `mine`, admin | `deferred` — `/mempalace` loads it | ~1 300 tokens, only while loaded |

Every call is validated before it reaches the palace (`commands.ts`): an unknown command is refused with
near matches, a missing required parameter is named, and a parameter the command would silently ignore is
refused rather than dropped. Calling a write command through the recall tool is refused with the loader
hint rather than worked around.

Three commands exist because a single `mempalace` command could not express the job:

- **`fact`** files one checkable fact as a knowledge-graph triple *and* a project-fact drawer in one call.
  Pass `oldObject` and it supersedes: the old value closes and the new one opens at one instant, and it
  refuses to supersede a value that is not currently recorded — upstream `tool_kg_supersede` accepts one
  and leaves two current facts.
- **`ask`** answers "what do I have on this?" with evidence, including the absence case: how many drawers
  were searched, how many cleared the similarity line, whether they were knowledge or archive, and the
  nearest miss.
- **`orphans`** finds drawers whose source file is gone — what `sync` reports as `unresolved` and never
  prunes.

## Write-path guard

Wings, rooms and entities are checked on every write: an exact name passes; a mechanical variant
(`project_facts`, `Open_Loops`) is rewritten onto the populated spelling; a near-miss is refused with a
"did you mean"; a genuinely new name is allowed but reported. An `add_drawer` with neither a `type:`
header nor an explicit room is refused.

This exists because the palace accumulated `project-facts` *and* `project_facts` in three wings, and one
person as three entities, and nothing refused any of it.

## Rendering

Results are rendered for reading rather than dumped as JSON: `kg_query` groups current facts by
predicate with `(+N more)` and counts the ended ones; `search` dedupes by drawer id, hides hits from the
session doing the searching, labels its 800-character previews, and broadens a weak match across wings
with capture rooms excluded; `open_loops` filters on each drawer's own `status:` field.

**6 skill files** — a command reference per surface, the reflection procedure, the knowledge-graph
vocabulary and temporal rules, topics/closets, and maintenance discipline. The tool descriptions reach
the model automatically; the skill carries what it needs to *choose*, and what it needs to *write well*.

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
