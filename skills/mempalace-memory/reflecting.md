# Reflecting — the pass where memory is written

Writing to the palace is a **decision**, and decisions are better made in one focused pass than scattered
through work. That is why `mempalace_manage` is deferred: it costs nothing until you open a reflection
session with `/mempalace`, and when it is open you are here to do one job.

## When to reflect

- A session is ending and something durable happened: a decision with rationale, a bug with its cause and
  fix, a fact that will still be true next month.
- A fact changed and the graph now says something false.
- The palace is drifting: search returning the same memory twice, rooms that mean nothing, a drawer
  contradicted by the code.
- Not mid-thought. If the thing is worth recording, it will still be worth recording in ten minutes.

## The pass, in order

1. **What did this session establish that is still true?**
   Test each candidate against "next month, would I act differently knowing this?" A decision's
   *rationale* is usually worth more than the decision: the choice is visible in the code, the reason is
   not.

2. **Is it already there?** `command="check_duplicate"` or `command="ask"`. A second copy of one memory is
   not corroboration; it is two rows that will drift apart.

3. **File it in the right shape.**

   | what you learned | command |
   |---|---|
   | a decision, with why and evidence | `remember` with `type: "decision"` |
   | one checkable value (`X uses Y`, `X is at path P`) | `fact` — triple and drawer in one call |
   | the same fact has changed | `fact` with `oldObject` |
   | a bug with its cause and fix | `remember` with `type: "problem"` |
   | something to follow up across sessions | `remember` with `type: "open_loop"` + `status`, `nextAction` |
   | what the session felt like | `diary_write` |

4. **Connect it.** A fact that names no entity is a note, not memory. If it links two things, that link is
   a triple: `topic:shaders` plus `about` facts is how a subject spans two projects, a repo and a skill.

5. **Correct what is now wrong.** When a memory is outdated, supersede or rewrite it — do not leave two
   desks of paper. `update_drawer` rewrites in place and moves closets with it; a fact that changed gets
   `fact` with `oldObject`.

6. **Stop.** Reflection is not a tidying compulsion. If nothing in the session passed step 1, the honest
   outcome is no writes.

## The discipline that matters

**A drawer is a record, not evidence.** Every claim in memory came from somewhere — a command's output, a
file, a measurement — and memory is a lossy copy of it. Before repeating a remembered claim as a fact,
check the source: the file, the git log, the actual command. This applies most to drawers written by a
past self about a topic the current session has not touched.

**Supersede, don't delete.** Closed history is the point: the wrong belief and what corrected it are both
worth having. Deleting a wrong drawer removes the correction along with the error.

**Never write what a call did not prove.** "The build works" is a claim; a command's exit status is
evidence. If the evidence is a sample, say so in the drawer.

## Organising an existing palace

The maintenance commands exist for the pass where the palace itself is the subject:

- `command="taxonomy"` — what rooms actually exist, with counts. Read it before believing any list of
  rooms, including one in a document.
- `command="orphans"` — drawers whose source file is gone. Dry run first; a source that still exists is
  never touched.
- `command="closets"` — rebuild the ranking layer after rooms or drawers moved.
- `command="kg_query"` + `kg_stats` — find entities that forked (`Evert` and `Evert Vorster`), predicates
  outside the vocabulary, facts whose window is wrong.

Bulk work follows the rules in [maintenance](maintenance.md): dry run and read the *diff* not the counts, gate
anything generated mechanically on shape, verify with a complete scan, back up before destructive passes,
and serialise writes because the palace has one writer.
