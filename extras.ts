/**
 * The three tools that are not a thin wrapper over one `mempalace` command:
 *
 *  - `mempalace_fact`   — one checkable fact, as a triple plus a drawer
 *  - `mempalace_ask`    — what do I have on this, with proof when it is nothing
 *  - `mempalace_maintain` — the rare, dry-run-first passes over the whole palace
 *
 * Keep this file to registrations: a tool decides *what* to call and how to say
 * what happened. The rules live in policy.ts, the python plumbing in palace.ts.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { runHelper, errorText } from "./palace.ts";
import { isBoundaryInstant, MAINTAIN_TASKS } from "./policy.ts";

/**
 * `mempalace_fact` — one checkable fact, as a triple plus a drawer.
 *
 * Superseding is not a separate tool and not a separate mode: passing
 * `oldObject` *is* the mode, because a replacement that does not say what it
 * replaces is not a replacement. One fewer parameter, and no invalid
 * combination of parameters to validate.
 */
function registerFact(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "mempalace_fact",
    label: "MemPalace Fact",
    description:
      "File one durable fact as BOTH a knowledge-graph triple and a project-fact drawer, in a single call. Use it instead of remember() when the thing you learned is a checkable value: X uses Y, X is in path P, X maintains Y. Pass oldObject as well when a single-valued fact has changed, and the old value is closed at one boundary instead of leaving two current facts.",
    promptSnippet:
      "Record a durable fact as a triple plus a drawer in one call — the structured path should be the cheap one.",
    promptGuidelines: [
      "Use mempalace_fact when the fact is a single checkable value with a clear subject and predicate; use mempalace_remember when it is an explanation or a decision with rationale.",
      "When a single-valued fact changes (pi's default model, a machine's name, a project's coordinator), pass oldObject as well: the old value is closed at one instant and the point-in-time query returns only the new one.",
      "oldObject must be the value currently recorded — confirm it with mempalace_kg_query first, because superseding a value that is not recorded fails rather than guessing.",
      "For a fact that simply ended with no successor use mempalace_kg_invalidate, and for an independent fact that can coexist with others use mempalace_kg_add.",
    ],
    parameters: Type.Object({
      subject: Type.String({ description: "Entity the fact is about (e.g. 'SpaceSim', 'pi', 'Evert.Scar')" }),
      predicate: Type.String({
        description:
          "Relationship, from the closed vocabulary (is_a, uses, uses_model, located_in, maintains, has_repo, measured, status, …)",
      }),
      object: Type.String({ description: "The value or target of the relationship" }),
      summary: Type.Optional(
        Type.String({
          description: "One-line statement of the fact for the drawer — required when adding, ignored when superseding",
        }),
      ),
      oldObject: Type.Optional(
        Type.String({ description: "The value being replaced. Pass this only when superseding a single-valued fact." }),
      ),
      at: Type.Optional(
        Type.String({
          description: "Boundary instant for a supersede: YYYY-MM-DD or YYYY-MM-DDTHH:MM:SSZ (default: now UTC)",
        }),
      ),
      details: Type.Optional(Type.String({ description: "Optional longer explanation" })),
      evidence: Type.Optional(Type.String({ description: "Optional evidence: command output, file, measurement" })),
      wing: Type.Optional(Type.String({ description: "Wing for the drawer, default 'pi'" })),
      validFrom: Type.Optional(Type.String({ description: "When the fact became true (YYYY-MM-DD, optional)" })),
      source: Type.Optional(Type.String({ description: "Source label, default 'pi-session:memory-fact'" })),
    }),

    async execute(_toolCallId, params, signal) {
      const text = (value: unknown) => String(value ?? "").trim();
      const subject = text(params.subject);
      const predicate = text(params.predicate);
      const object = text(params.object);
      const oldObject = text(params.oldObject);
      const at = text(params.at) || undefined;
      const superseding = oldObject.length > 0;

      const required = [
        ["subject", subject],
        ["predicate", predicate],
        ["object", object],
        superseding ? ["oldObject", oldObject] : ["summary", text(params.summary)],
      ]
        .filter(([, value]) => !value)
        .map(([name]) => name);
      if (required.length > 0) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text:
                `Missing required ${required.length === 1 ? "parameter" : "parameters"}: ${required.join(", ")}.` +
                (superseding ? "" : " To replace an existing value, pass oldObject as well."),
            },
          ],
          details: { missing: required },
        };
      }

      if (superseding && oldObject === object) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text:
                `oldObject and object are both "${object}", so nothing changes and there is nothing to supersede. ` +
                "Pass the value actually being replaced, or drop oldObject to add an independent fact.",
            },
          ],
          details: { subject, predicate, object, oldObject },
        };
      }

      if (at !== undefined && !isBoundaryInstant(at)) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text:
                `at="${at}" is not an accepted boundary instant. Use YYYY-MM-DD or YYYY-MM-DDTHH:MM:SSZ. ` +
                "Partial dates and local times are rejected because KG temporal values are compared as text, " +
                "and mixed formats silently return wrong query results.",
            },
          ],
          details: { at },
        };
      }

      try {
        if (superseding) {
          const data = (await runHelper(
            "kg_supersede.py",
            { subject, predicate, old_object: oldObject, new_object: object, at },
            signal,
          )) as Record<string, unknown>;

          const lines = [
            `Superseded: ${data?.fact ?? `${subject} → ${predicate} → ${object}`}`,
            `Previously: ${data?.superseded ?? oldObject}`,
            `Boundary: ${at ?? "now (UTC)"}`,
          ];
          if (data?.triple_id) lines.push(`Triple ID: ${data.triple_id}`);
          pi.appendEntry("mempalace-kg-superseded", {
            subject,
            predicate,
            oldObject,
            newObject: object,
            at,
            data,
            timestamp: new Date().toISOString(),
          });
          return { content: [{ type: "text" as const, text: lines.join("\n") }], details: data };
        }

        const data = (await runHelper(
          "fact.py",
          {
            subject,
            predicate,
            object,
            summary: text(params.summary),
            details: params.details,
            evidence: params.evidence,
            wing: params.wing,
            valid_from: params.validFrom,
            source: params.source,
          },
          signal,
        )) as Record<string, unknown>;

        pi.appendEntry("mempalace-fact", { ...data, timestamp: new Date().toISOString() });
        return {
          content: [
            {
              type: "text" as const,
              text: `Fact filed: ${data.fact}\n  triple: ${data.triple_id}\n  drawer: ${data.drawer_id} (${data.room})`,
            },
          ],
          details: data,
        };
      } catch (error) {
        const message = errorText(error);
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text:
                `${superseding ? "Supersede" : "Fact"} was not filed: ${message}` +
                (superseding && !/currently recorded|no current/i.test(message)
                  ? "\nIf the boundary is inverted (at earlier than the fact's start), pick a later instant."
                  : ""),
            },
          ],
          details: { subject, predicate, object, oldObject, at, error: message },
        };
      }
    },
  });
}

/** `mempalace_ask` — what do I have on this, with proof when the answer is nothing. */
function registerAsk(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "mempalace_ask",
    label: "MemPalace Ask",
    description:
      "Answer 'what do I have on this?' with evidence, including the absence case. Reports the corpus size searched, hits above a similarity line, whether they are filed knowledge or raw capture, and the nearest thing below the line.",
    promptSnippet: "Ask what the palace actually holds on a topic — and get proof when the answer is nothing.",
    promptGuidelines: [
      "Use this before saying 'I have nothing on that': it searches every wing and reports the scope, so absence is measured rather than assumed.",
      "Verdict 'knowledge' means filed memories matched; 'archive-only' means only transcripts/diary did (an event record, not knowledge); 'nothing' means no drawer cleared the line.",
      "Raise minSimilarity to be stricter; lower it to widen the net when you suspect the wording differs.",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "Topic or question to check coverage for" }),
      minSimilarity: Type.Optional(
        Type.Number({ description: "Similarity line between stored and noise, default 0.45", minimum: 0, maximum: 1 }),
      ),
      limit: Type.Optional(Type.Number({ description: "Max hits considered, default 20", minimum: 1, maximum: 50 })),
      includeKg: Type.Optional(Type.Boolean({ description: "Also ask the knowledge graph about the topic, default true" })),
    }),

    async execute(_toolCallId, params, signal) {
      if (!String(params.query ?? "").trim()) {
        return { isError: true, content: [{ type: "text" as const, text: "query is required." }], details: {} };
      }
      try {
        const data = (await runHelper(
          "coverage.py",
          {
            query: String(params.query).trim(),
            min_similarity: params.minSimilarity,
            limit: params.limit,
            include_kg: params.includeKg !== false,
          },
          signal,
        )) as Record<string, any>;

        const scope = data.scope ?? {};
        const lines = [
          `"${data.query}" — searched ${scope.drawers} drawers across ${scope.wings} wings / ${scope.rooms} rooms`,
          `hits above similarity ${data.threshold}: ${data.hit_count}`,
        ];
        for (const hit of data.knowledge_hits ?? []) {
          lines.push(`  ${String(hit.similarity).padEnd(5)} ${hit.wing}/${hit.room}  ${hit.drawer_id ?? ""}`);
        }
        if (data.archive_hits > 0) {
          lines.push(`  ${data.archive_hits} hit(s) in capture rooms (transcripts/diary) — event record, not knowledge`);
        }
        const kg = (data.kg_facts ?? []) as any[];
        if (kg.length > 0) {
          lines.push(`knowledge graph: ${kg.map((f) => `${f.predicate} ${f.object}`).join("; ")}`);
        }
        if (data.verdict === "nothing") {
          const near = data.nearest_below_threshold;
          lines.push(
            `verdict: NOTHING STORED above ${data.threshold}` +
              (near ? ` — nearest ${near.similarity} in ${near.wing}/${near.room}` : ""),
          );
        } else if (data.verdict === "archive-only") {
          lines.push("verdict: archive only — we talked about it, but nothing was filed as knowledge");
        } else {
          lines.push("verdict: knowledge found");
        }
        return { content: [{ type: "text" as const, text: lines.join("\n") }], details: data };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: `Ask failed: ${errorText(error)}` }],
          details: { error: errorText(error) },
        };
      }
    },
  });
}

/** `mempalace_maintain` — the rare, dry-run-first passes over the whole palace. */
function registerMaintain(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "mempalace_maintain",
    label: "MemPalace Maintain",
    description:
      "Palace-wide maintenance, dry-run by default. task='orphans' finds drawers whose source file no longer exists (what mempalace_sync reports as 'unresolved' and never prunes); task='closets' rebuilds the closet ranking layer from current drawers, needed after rooms or drawers moved.",
    promptSnippet: "Sweep orphaned drawers, or rebuild the closet ranking layer — dry-run first.",
    promptGuidelines: [
      "Run with apply=false first and read the counts; a source that still exists is never touched.",
      "Only absolute source paths are considered orphans — labels like 'pi-session:…' are deliberate provenance.",
      "Take a palace backup (sqlite3 .backup) before apply=true; deletion is not reversible through the API.",
      "task='closets' rebuilds from current drawers and never re-mines: re-mining a recaptured source would re-add the raw transcript and undo the digest pass.",
      "Closets are cue lines pointing at drawer ids and are filtered by wing+room; they are a ranking boost, never a gate, so a stale closet degrades ranking but cannot hide drawers.",
    ],
    parameters: Type.Object({
      task: Type.Union([Type.Literal("orphans"), Type.Literal("closets")], {
        description: "Which pass to run: 'orphans' sweeps missing sources, 'closets' rebuilds the ranking layer",
      }),
      wing: Type.Optional(Type.String({ description: "Restrict to one wing (closets: omit for every wing)" })),
      room: Type.Optional(Type.String({ description: "Orphans only: restrict to one room, e.g. 'general'" })),
      apply: Type.Optional(Type.Boolean({ description: "Write the change (default false — dry run)" })),
      limit: Type.Optional(Type.Number({ description: "Safety cap: orphan sources deleted, or closet source files" })),
    }),

    async execute(_toolCallId, params, signal) {
      const apply = params.apply === true;

      if (!MAINTAIN_TASKS.includes(params.task)) {
        return {
          isError: true,
          content: [
            { type: "text" as const, text: `task must be one of: ${MAINTAIN_TASKS.join(", ")}.` },
          ],
          details: { task: params.task },
        };
      }

      try {
        if (params.task === "closets") {
          const data = (await runHelper(
            "closets_rebuild.py",
            { wing: params.wing, limit: params.limit, apply },
            signal,
          )) as Record<string, unknown>;
          const text = [
            `${data.wing}: ${data.drawers} drawers over ${data.sources} sources, ${data.room_groups} room groups`,
            apply ? `closets written: ${data.closets_written}` : "(dry run — pass apply=true to write)",
          ].join("\n");
          return { content: [{ type: "text" as const, text }], details: data };
        }

        const data = (await runHelper(
          "orphans.py",
          { wing: params.wing, room: params.room, apply, limit: params.limit },
          signal,
        )) as Record<string, unknown>;

        const lines = [
          `sources scanned: ${data.scanned_sources}`,
          `orphaned sources: ${data.orphan_sources}  (${data.orphan_drawers} drawers)`,
        ];
        const largest = Array.isArray(data.largest) ? (data.largest as any[]) : [];
        for (const row of largest) {
          lines.push(`  ${String(row.drawers).padStart(4)}  ${String(row.source).slice(-90)}`);
        }
        if (data.apply) {
          lines.push(`deleted: ${data.deleted_sources} sources / ${data.deleted_drawers} drawers`);
        } else {
          lines.push("(dry run — pass apply=true to delete)");
        }
        if (Array.isArray(data.failures) && data.failures.length > 0) {
          lines.push(`failures: ${data.failures.length}`);
        }
        return { content: [{ type: "text" as const, text: lines.join("\n") }], details: data };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: `Maintenance failed: ${errorText(error)}` }],
          details: { task: params.task, error: errorText(error) },
        };
      }
    },
  });
}

export function registerExtras(pi: ExtensionAPI): void {
  registerFact(pi);
  registerAsk(pi);
  registerMaintain(pi);
}
