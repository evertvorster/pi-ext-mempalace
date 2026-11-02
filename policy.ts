/**
 * MemPalace policy — the rules this extension applies, in one place.
 *
 * Everything here is pure: no pi API, no python, no filesystem. That is what
 * makes it testable, and these are the rules that have actually gone wrong —
 * type→room deciding where a drawer lands, and name resolution deciding whether
 * a write forks a second room, wing or entity.
 */

/**
 * Memory type → room. Applied only when the caller supplied no room: `type` is
 * the memory class, `room` is the subject, and an explicit topic room wins.
 * Overriding `evert/family` because its drawers are typed `project_fact` would
 * flatten deliberate structure in exchange for uniformity nobody queries.
 */
export const TYPE_ROOM: Record<string, string> = {
  decision: "decisions",
  preference: "preferences",
  milestone: "milestones",
  problem: "problems",
  emotional_context: "emotional-context",
  project_fact: "project-facts",
  workflow: "workflows",
  quote: "quotes",
  open_loop: "open-loops",
  reference: "references",
};

/** Rooms holding raw session capture rather than filed knowledge. */
export const CAPTURE_ROOMS = new Set(["transcripts", "diary"]);

/**
 * Accepted KG boundary instants. Text comparison, so the format matters: a bare
 * date means "valid through the whole day", which is why an invalidated fact can
 * still appear in today's active_facts until midnight.
 */
export function isBoundaryInstant(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(Z|\+00:00))?$/.test(value);
}

/** Best similarity below this is a weak match: the palace ranks, it never rejects. */
export const WEAK_MATCH = 0.4;

/** Read a `type:` header out of the drawer content, if it carries one. */
export function typeFromContent(content: string): string | undefined {
  const match = /(?:^|\n)type:\s*([a-z_]+)/i.exec(content);
  return match ? match[1].toLowerCase() : undefined;
}

/** True when every room in the set is raw capture. */
export function isCaptureOnly(rooms: Iterable<string>): boolean {
  const list = [...rooms];
  return list.length > 0 && list.every((room) => CAPTURE_ROOMS.has(room));
}

/**
 * True when a search hit came from the session doing the searching.
 *
 * Those hits rank first because they literally contain the query wording, and
 * they are already in context — noise that looks like evidence.
 */
export function isFromSession(row: unknown, sessionId: string): boolean {
  if (!sessionId) return false;
  const r = row as { source_file?: unknown; text?: unknown; content?: unknown };
  return String(r?.source_file ?? "").includes(sessionId) || String(r?.text ?? r?.content ?? "").includes(sessionId);
}

/** Mechanical equivalence: case, spaces/underscores vs hyphens, plural 's'. */
export function normalizeName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function pluralEquivalent(a: string, b: string): boolean {
  return a === `${b}s` || b === `${a}s` || a === `${b}es` || b === `${a}es`;
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let last = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, last + (a[i - 1] === b[j - 1] ? 0 : 1));
      last = tmp;
    }
  }
  return prev[b.length];
}

/** Closest candidate within a typo-sized distance, or undefined. */
export function closestName(value: string, candidates: string[]): string | undefined {
  const target = normalizeName(value);
  let best: { name: string; distance: number } | undefined;
  for (const candidate of candidates) {
    const normal = normalizeName(candidate);
    if (normal === target || pluralEquivalent(normal, target)) continue; // handled as a rewrite
    const distance = levenshtein(target, normal);
    const limit = Math.max(2, Math.floor(target.length / 3));
    if (distance <= limit && (!best || distance < best.distance)) {
      best = { name: candidate, distance };
    }
  }
  return best?.name;
}

export type Resolution =
  | { kind: "ok"; value: string; rewritten?: string }
  | { kind: "new"; value: string }
  | { kind: "blocked"; message: string };

/**
 * Resolve a wing or room name against what the palace already holds.
 *
 * `candidates` carries drawer counts so that, when two mechanically equivalent
 * spellings both exist (the `project-facts` / `project_facts` split), the
 * populated one wins and the write is steered onto it.
 */
export function resolveIn(
  value: string,
  candidates: Array<[name: string, count: number]>,
  what: string,
  context: string,
): Resolution {
  const names = candidates.map(([name]) => name);
  const target = normalizeName(value);

  const equivalents = candidates.filter(([name]) => {
    const normal = normalizeName(name);
    return normal === target || pluralEquivalent(normal, target);
  });

  if (equivalents.length > 0) {
    equivalents.sort((a, b) => b[1] - a[1]);
    const winner = equivalents[0][0];
    if (winner === value) return { kind: "ok", value };
    return { kind: "ok", value: winner, rewritten: winner };
  }

  const near = closestName(value, names);
  if (near) {
    return {
      kind: "blocked",
      message:
        `${what} "${value}" does not exist${context}. Did you mean "${near}"? ` +
        `Retry with that exact spelling — a second variant silently splits the same content across two ${what.toLowerCase()}s. ` +
        `Known values: ${names.slice(0, 12).join(", ")}${names.length > 12 ? ", …" : ""}.`,
    };
  }

  return { kind: "new", value };
}

/** True when `a` reads as an abbreviated spelling of `b` ("Evert" vs "Evert Vorster"). */
export function tokenSubset(a: string, b: string): boolean {
  const left = normalizeName(a).split("-").filter(Boolean);
  const right = normalizeName(b).split("-").filter(Boolean);
  if (left.length === 0 || left.length >= right.length) return false;
  return left.every((token) => right.includes(token));
}

/**
 * Resolve a KG subject against the entities that already exist.
 *
 * Guards the failure the graph already contained: `Evert` and `Evert Vorster`
 * were the same person as two entities, because nothing checked the name.
 */
export function resolveEntity(subject: string, entities: string[]): Resolution {
  if (entities.includes(subject)) return { kind: "ok", value: subject };

  const target = normalizeName(subject);
  const mechanical = entities.find((name) => normalizeName(name) === target);
  if (mechanical) return { kind: "ok", value: mechanical, rewritten: mechanical };

  const subset = entities.find((name) => tokenSubset(subject, name));
  if (subset) {
    return {
      kind: "blocked",
      message:
        `Entity "${subject}" looks like an abbreviation of the existing entity "${subset}". ` +
        `Retry with "${subset}" — a second spelling splits the same entity's facts across two node names, ` +
        "and neither query will see the whole picture. If these really are different entities, " +
        `disambiguate the new one (e.g. "${subject} Vorster").`,
    };
  }

  const near = closestName(subject, entities);
  if (near) {
    return {
      kind: "blocked",
      message:
        `Entity "${subject}" does not exist and looks like a typo of "${near}". ` +
        `Retry with "${near}", or use a clearly new name if this is a different entity.`,
    };
  }

  return { kind: "new", value: subject };
}
