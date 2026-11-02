/**
 * Write-path guard: names are resolved against what the palace already holds,
 * through the documented `tool_call` / `tool_result` hooks.
 *
 * An exact wing/room/entity match passes; a mechanical variant is rewritten
 * (`project_facts` -> `project-facts`, and the populated spelling wins when both
 * exist); a near-miss is blocked with a "did you mean"; and a genuinely new name
 * is allowed but reported, because a typo that silently mints a second room
 * splits the same content in two and nothing downstream can tell.
 *
 * This is the failure the palace actually had: `project-facts` and
 * `project_facts` coexisting in three wings, and one person recorded as three
 * entities. Nothing refused any of it, so the refusal had to be mechanical.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { loadEntities, loadTaxonomy } from "./palace.ts";
import { resolveEntity, resolveIn, TYPE_ROOM, typeFromContent } from "./policy.ts";

const WRITE_TOOLS = new Set(["mempalace_remember", "mempalace_add_drawer", "mempalace_update_drawer"]);

/** Tools whose `subject` names a KG entity and must not fork a second spelling. */
const SUBJECT_TOOLS = new Set(["mempalace_kg_add", "mempalace_fact"]);

// NOTE: the zero-call navigation tools (traverse, tunnels, hallways, graph_stats)
// were briefly deactivated here and are deliberately left ACTIVE. Zero calls in
// the 2026-11-02 measurement does not mean no use — we may start using them, and
// hiding a registered tool only removes the option. Revisit only with evidence of
// absence, not absence of evidence.

/** Notes stashed by `tool_call`, appended to the result by `tool_result`. */
const pendingNotes = new Map<string, string[]>();

function appendNote(toolCallId: string, note: string): void {
  const notes = pendingNotes.get(toolCallId) ?? [];
  notes.push(note);
  pendingNotes.set(toolCallId, notes);
}

export function registerGuard(pi: ExtensionAPI): void {
  pi.on("tool_call", async (event) => {
    // ── KG writes: keep one spelling per entity ──
    if (SUBJECT_TOOLS.has(event.toolName)) {
      const input = event.input as Record<string, unknown>;
      const subject = typeof input.subject === "string" ? input.subject.trim() : "";
      if (!subject) return undefined;

      const entities = await loadEntities();
      if (!entities) return undefined;

      const resolution = resolveEntity(subject, entities);
      if (resolution.kind === "blocked") return { block: true, reason: resolution.message };
      if (resolution.kind === "new") {
        appendNote(event.toolCallId, `note: entity "${subject}" is new to the knowledge graph.`);
      } else if (resolution.rewritten) {
        input.subject = resolution.rewritten;
        appendNote(event.toolCallId, `note: entity "${subject}" resolved to "${resolution.rewritten}".`);
      }
      return undefined;
    }

    if (!WRITE_TOOLS.has(event.toolName)) return undefined;

    const input = event.input as Record<string, unknown>;

    // A drawer's own `type:` header supplies a room only when the caller did not
    // choose one; see TYPE_ROOM in policy.ts for why it is a default, not an override.
    if (typeof input.content === "string") {
      const type = typeFromContent(input.content);
      const derived = type ? TYPE_ROOM[type] : undefined;
      const requested = typeof input.room === "string" ? input.room.trim() : "";
      if (derived && !requested) {
        input.room = derived;
        appendNote(event.toolCallId, `note: no room given — type "${type}" filed it under "${derived}".`);
      }
    }
    const requestedWing = typeof input.wing === "string" ? input.wing.trim() : "";
    const requestedRoom = typeof input.room === "string" ? input.room.trim() : "";

    // add_drawer was the one write path that could file content with no
    // classification at all — every flat bucket in the palace came from here.
    if (event.toolName === "mempalace_add_drawer" && !requestedRoom) {
      return {
        block: true,
        reason:
          "add_drawer needs a classification: put a `type:` header in the content " +
          "(decision, project_fact, open_loop, milestone, problem, preference, workflow, quote, reference, " +
          "emotional_context) or pass an explicit room. Writes with neither are how the 'general' room " +
          "grew to 2,309 drawers.",
      };
    }

    if (!requestedWing && !requestedRoom) return undefined;
    const taxonomy = await loadTaxonomy();
    if (!taxonomy) return undefined; // palace unavailable: behave like the plain tool

    const wings: Array<[string, number]> = Object.entries(taxonomy).map(([wing, rooms]) => [
      wing,
      Object.values(rooms).reduce((total, count) => total + count, 0),
    ]);

    if (requestedWing) {
      const resolution = resolveIn(requestedWing, wings, "Wing", "");
      if (resolution.kind === "blocked") return { block: true, reason: resolution.message };
      if (resolution.kind === "new") {
        appendNote(event.toolCallId, `note: wing "${requestedWing}" did not exist before this call and was created.`);
      } else if (resolution.rewritten) {
        input.wing = resolution.rewritten;
        appendNote(event.toolCallId, `note: wing "${requestedWing}" resolved to "${resolution.rewritten}".`);
      }
    }

    if (requestedRoom) {
      // Resolve against the rooms of the wing this write will land in. Without an
      // explicit wing we do not know the target, so every wing's rooms are used
      // and counts are summed, which still prefers the populated spelling.
      const ownRooms = requestedWing ? taxonomy[requestedWing] : undefined;
      const roomCounts = new Map<string, number>();
      if (ownRooms) {
        for (const [room, count] of Object.entries(ownRooms)) roomCounts.set(room, count);
      } else {
        for (const rooms of Object.values(taxonomy)) {
          for (const [room, count] of Object.entries(rooms)) {
            roomCounts.set(room, (roomCounts.get(room) ?? 0) + count);
          }
        }
      }
      const context = requestedWing ? ` in wing "${requestedWing}"` : "";

      const resolution = resolveIn(requestedRoom, [...roomCounts.entries()], "Room", context);
      if (resolution.kind === "blocked") return { block: true, reason: resolution.message };
      if (resolution.kind === "new") {
        appendNote(
          event.toolCallId,
          `note: room "${requestedRoom}" did not exist${context} and was created — if this is a typo, the content is now split.`,
        );
      } else if (resolution.rewritten) {
        input.room = resolution.rewritten;
        appendNote(event.toolCallId, `note: room "${requestedRoom}" resolved to "${resolution.rewritten}".`);
      }
    }

    return undefined;
  });

  pi.on("tool_result", async (event) => {
    // 1. Attach any pending name-resolution notes.
    const notes = pendingNotes.get(event.toolCallId);
    if (notes && notes.length > 0) {
      pendingNotes.delete(event.toolCallId);
      return { content: [...event.content, { type: "text" as const, text: `\n[guard] ${notes.join(" ")}` }] };
    }

    return undefined;
  });
}
