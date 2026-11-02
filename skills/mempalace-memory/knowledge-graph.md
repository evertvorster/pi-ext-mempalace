# Knowledge graph

The KG stores **typed entity relationships with temporal validity**. It is the store for one checkable
value that changes over time; a drawer is the store for an explanation. Filing a fact as prose and a
paragraph as a triple are both mistakes, and both have happened here.

| question | store |
|---|---|
| "What is X to Y?", "which model does pi use, and since when?" | the graph — typed, time-bounded, exact, no ranking |
| "Did we ever discuss Z?", rationale, narrative, quotes | drawers |
| "What is pending?" | drawers, filtered by `status:` |
| A decision, with why and evidence | a drawer, not a triple |

The graph is worth querying because it is **small enough to be exact**. 285 entities and 379 triples are
useful; thousands of low-confidence triples mined from conversation would be worse than nothing.

## Writing a fact

```
command=fact(subject, predicate, object, summary, details?, evidence?, wing?, validFrom?)
```

Files the triple **and** a project-fact drawer in one call, so the structured path costs one action.
Prefer it over `kg_add` + `remember`, which is two writes that can disagree.

`kg_add` remains for a fact that needs no drawer and no prose — a bulk seeding run, a mechanical
relationship.

## Changing a fact

Pass the value being replaced:

```
command=fact(subject="pi", predicate="uses_model",
               object="deepseek/deepseek-v4",
               oldObject="deepseek/deepseek-flash")
```

That closes the old value and opens the new one at **one shared instant**, so a point-in-time query at
the boundary returns only the new value. Do not hand-roll `kg_invalidate` + `kg_add`: the two calls land
at different instants, and a query "as of" that moment returns both values as current.

`oldObject` must be the value **actually recorded**. The tool refuses otherwise and names what is open:
superseding from a value that does not exist does not correct history, it leaves the real value open and
adds a new one beside it — two current facts, invented provenance.

Use `kg_invalidate` only when a fact ended with no successor, and `kg_add` when the new fact legitimately
coexists with the old (a person can have two children).

## Temporal semantics — date versus instant

- A **bare date** means "valid through that whole day". `kg_invalidate(ended="2026-11-02")` leaves the
  fact in `active_facts` until midnight, because `active_facts` is *validity window overlaps today*, not
  *current is true*. `kg_stats` and `as_of` queries treat it as ended immediately, so the two views
  disagree for the rest of the day.
- To end something **now**, pass a UTC instant: `ended="2026-11-02T00:00:00Z"`.
- `command=fact` rejects partial dates and local times for `at`. KG temporal values are compared as
  text, so mixed formats silently return wrong answers.
- **There is no KG delete.** `mempalace kg` offers only `normalize`. Closed history is permanent, and
  re-invalidating an ended fact returns success without rewriting `valid_to`. Test data written into the
  real graph stays there.

## Predicates — one closed vocabulary

Every new predicate costs a query pattern and a traversal. Use these, and map anything else onto them:

```
is_a  part_of  located_in  runs_on  uses  uses_model  depends_on
maintains  works_on  status  measured
child  spouse  sibling  step-parent  named_after  alias
has_repo  has_package  has_wing  about  description  contains_custom_tool
```

`measured` carries a labelled scalar: `ram_gb=62`, `vram_gb=16`. Status-like scalars go in `status`:
`kernel=7.2.14-arch1-1`. `about` links a subject to a `topic:` entity — that is how a topic reaches a
repo, a skill and a project's rooms from one query.

**The graph is not yet closed.** As measured 2026-11-02 it also contains `is`, `lives_in`, `full_name`,
`founder`, `co-founder`, `loves`, `nephew`, `tested_by`. These are strays from before the vocabulary
existed, and `mempalace kg normalize` is the tool that maps them onto it (plan first — it edits live
facts).

## Entity naming

- **One entity, one spelling.** `Evert` and `Evert Vorster` were the same person as two nodes, and a
  fact filed under one was invisible to a query on the other.
- **The canonical subject is the full name**; alternate spellings are their own `alias` triple
  (`Evert Vorster → alias → Evert`), so a short-name query still resolves.
- **Never encode a qualifier in a name.** `Evert Vorster (nephew, Cape Town)` is a wart: the city and the
  relationship belong in `located_in` and `nephew` facts about a distinct entity. A qualifier that
  distinguishes two people goes in the name *only* if they would otherwise be the same string.
- Direction is consistent: `subject → predicate → object` reads as a sentence. `Kobie → child → Evert`
  and `Evert → step-parent → Ethen` both read forwards; mixing directions makes traversal ambiguous.

The write guard enforces this mechanically on `kg_add` and `command=fact`: an existing entity passes, a
case/spelling variant is rewritten, an abbreviation of an existing name (`Evert` vs `Evert Vorster`) and
a near-miss typo are refused with the correct name offered, and a genuinely new entity is allowed but
reported.

## Where the facts came from

Mechanically, from authoritative local state — never from prose:

| source | facts |
|---|---|
| `hostnamectl`, `lscpu`, `nvidia-smi`, `/proc/meminfo` | the machine, its CPU, GPU, RAM and OS |
| git remotes under `~/Software/Projects` | repositories, their remotes and paths |
| `PKGBUILD` files | AUR packages and who maintains them |
| `~/.pi/agent/settings.json` | pi's default model, installed extensions |
| tools and skills on disk | `is_a pi_skill`, `located_in ~/.pi/agent/skills/…` |

The seeder lives at `~/.pi/agent/bin/mempalace_kg_seed.py`: dry-run by default, idempotent (it queries
before it writes), and gated on names being name-shaped after a regex wrote 35 malformed entities into
the live graph.

**Never mine conversation into the graph.** Transcripts are an event record; turning them into triples
would flood the one structure whose value is that every fact in it is exact.

## Reading it

`kg_query(entity, predicate?, limit?, as_of?, direction="both")`. `direction` is the part people miss:
`both` (default) is right for "what do we know about X", but "who maintains this package" is
`direction="incoming"` on the package, not an outgoing query on the maintainer.

`kg_timeline(entity)` gives the same facts as a chronology — the story of a node rather than its present.
