/**
 * Result renderers.
 *
 * These exist because the raw output scales badly against our own data: one
 * kg_query returned 73 pretty-printed facts for a single person, a search hit
 * carried a 50 KB session dump, and `open_loops` served finished work. Rendering
 * is the overlay's job; the tools stay as the package ships them.
 */

import { CAPTURE_ROOMS, isCaptureOnly, isFromSession, WEAK_MATCH } from "./policy.ts";
import { runBridge } from "./palace.ts";

const KG_MAX_PER_PREDICATE = 8;
const SEARCH_MAX_RESULT_CHARS = 2000;
const DEDUPE_PREFIX = 120;

/** Drop repeats: same drawer id first (chunks differ in text), then same opening text. */
export function dedupeResults(results: any[]): { kept: any[]; dropped: number } {
  const seenIds = new Set<string>();
  const seenText = new Set<string>();
  const kept: any[] = [];
  for (const r of results) {
    const id = typeof r?.drawer_id === "string" ? r.drawer_id : "";
    if (id && seenIds.has(id)) continue;
    const key = String(r?.text ?? r?.content ?? "").replace(/\s+/g, " ").trim().slice(0, DEDUPE_PREFIX);
    if (!id && key.length > 0 && seenText.has(key)) continue;
    if (id) seenIds.add(id);
    if (key.length > 0) seenText.add(key);
    kept.push(r);
  }
  return { kept, dropped: results.length - kept.length };
}

/** Compact, grouped rendering for kg_query: current facts only, one line each. */
export function renderKgQuery(details: unknown, entity: string): string | undefined {
  if (!details || typeof details !== "object") return undefined;
  const all = (details as Record<string, unknown>).facts;
  if (!Array.isArray(all)) return undefined;

  const current = all.filter((f: any) => f && f.current !== false);
  const ended = all.length - current.length;
  if (current.length === 0) {
    return `No current facts for "${entity}"${ended ? ` (${ended} ended)` : ""}.`;
  }

  const groups = new Map<string, string[]>();
  for (const fact of current as any[]) {
    const list = groups.get(String(fact.predicate)) ?? [];
    list.push(String(fact.object));
    groups.set(String(fact.predicate), list);
  }

  const lines = [`"${entity}" — ${current.length} current fact${current.length === 1 ? "" : "s"}`];
  for (const [predicate, objects] of [...groups.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const shown = objects.slice(0, KG_MAX_PER_PREDICATE);
    const more = objects.length - shown.length;
    lines.push(`  ${predicate}: ${shown.join(", ")}${more > 0 ? ` (+${more} more)` : ""}`);
  }
  if (ended > 0) lines.push(`  (${ended} ended fact${ended === 1 ? "" : "s"} hidden)`);
  return lines.join("\n");
}

/** Compact rendering for list_drawers: one line per drawer, ids and provenance visible. */
export function renderListDrawers(details: unknown): string | undefined {
  if (!details || typeof details !== "object") return undefined;
  const drawers = (details as Record<string, unknown>).drawers;
  if (!Array.isArray(drawers)) return undefined;
  const total = Number((details as Record<string, unknown>).total ?? drawers.length);
  if (drawers.length === 0) return `No drawers (total 0).`;

  const lines = drawers.map((d: any) => {
    const preview = String(d?.content_preview ?? "").replace(/\s+/g, " ").trim().slice(0, 110);
    const source = d?.metadata?.source_file;
    const src = typeof source === "string" && source ? `\n    src: ${source.slice(-80)}` : "";
    return `${d?.drawer_id ?? "?"}  ${d?.wing ?? "?"}/${d?.room ?? "?"}${src}\n    ${preview}`;
  });
  return `showing ${drawers.length} of ${total}\n${lines.join("\n")}`;
}

/**
 * Search rendering: dedupe, drop this session's own capture, cap text, broaden a weak match.
 *
 * The palace ranks, it never rejects — a nonsense query comes back with five
 * confident-looking results — so "weak" has to be decided here and said out loud.
 */
export async function renderSearch(
  details: unknown,
  query: string,
  sessionFile: string,
  options: { broaden: boolean } = { broaden: true },
): Promise<string | undefined> {
  if (!details || typeof details !== "object") return undefined;
  const raw = (details as Record<string, unknown>).results;
  if (!Array.isArray(raw)) return undefined;

  if (raw.length === 0) {
    return (
      `No results for: ${query}\n` +
      "Try dropping the wing scope, or check the room spelling with mempalace_list_rooms."
    );
  }

  const { kept: deduped, dropped: droppedDupes } = dedupeResults(raw as any[]);

  const sessionId = sessionFile.split("/").pop() ?? "";
  const kept = deduped.filter((r: any) => !isFromSession(r, sessionId));
  const droppedSession = deduped.length - kept.length;

  if (kept.length === 0) {
    return (
      `No results outside this session for: ${query}\n` +
      (droppedSession > 0
        ? `${droppedSession} hit${droppedSession === 1 ? "" : "s"} came from this session (already in context) and were hidden.\n`
        : "") +
      "Try dropping the wing scope, or check the room spelling with mempalace_list_rooms."
    );
  }

  const best = Math.max(...kept.map((r: any) => Number(r?.similarity ?? 0)));
  const rooms = new Set(kept.map((r: any) => String(r?.room ?? "?")));
  const onlyPassive = isCaptureOnly(rooms);

  const render = (rows: any[]): string =>
    rows
      .map((r, i) => {
        let text = String(r?.text ?? r?.content ?? "");
        if (text.length > SEARCH_MAX_RESULT_CHARS) {
          text =
            `${text.slice(0, SEARCH_MAX_RESULT_CHARS)}\n` +
            `… [${text.length - SEARCH_MAX_RESULT_CHARS} more characters not shown]`;
        }
        const sim = r?.similarity === undefined ? "" : ` sim=${Number(r.similarity).toFixed(2)}`;
        const src = r?.source_file ? ` source=${r.source_file}` : "";
        const id = r?.drawer_id ? ` id=${r.drawer_id}` : "";
        return `[${i + 1}] ${r?.wing ?? "?"}/${r?.room ?? "?"}${sim}${src}${id}\n${text}`;
      })
      .join("\n\n────────────────────────────────\n\n");

  const notes: string[] = [];
  if (droppedDupes > 0) notes.push(`[guard] ${droppedDupes} duplicate hit${droppedDupes === 1 ? "" : "s"} suppressed.`);
  if (droppedSession > 0) {
    notes.push(
      `[guard] ${droppedSession} hit${droppedSession === 1 ? "" : "s"} from this session hidden (already in context).`,
    );
  }
  const previewsCut = kept.filter((r: any) => String(r?.text ?? "").length >= 780);
  if (previewsCut.length > 0) {
    notes.push(
      `[guard] ${previewsCut.length} of these are 800-character previews — ` +
        "call mempalace_get_drawer with the hit's drawer_id for the full text.",
    );
  }
  if (onlyPassive) {
    notes.push(`[guard] Every hit came from ${[...rooms].join("/")} — raw capture, not filed memory.`);
  }

  // Recall side: a weak or capture-only result is worth one broader attempt
  // before answering, with capture rooms excluded so the second pass can only
  // find filed knowledge.
  let broadened: any[] = [];
  if (options.broaden && (best < WEAK_MATCH || onlyPassive)) {
    let wider: any = null;
    try {
      wider = await runBridge("search", { query, limit: 15 });
    } catch {
      wider = null; // a failed second look is not an error; the first answer stands
    }
    const rows = Array.isArray(wider?.results) ? wider.results : [];
    const shownIds = new Set(kept.map((r: any) => r?.drawer_id).filter(Boolean));
    const fresh = rows.filter(
      (r: any) => !CAPTURE_ROOMS.has(String(r?.room ?? "")) && !shownIds.has(r?.drawer_id) && !isFromSession(r, sessionId),
    );
    broadened = dedupeResults(fresh).kept.slice(0, 3);
    if (broadened.length > 0) {
      notes.push(
        `[guard] Weak match (best similarity ${best.toFixed(2)}) — broadened to all wings, capture rooms excluded:`,
      );
    }
  }

  const parts = [render(kept)];
  if (broadened.length > 0) parts.push(render(broadened));
  return `${parts.join("\n\n════════ broadened ════════\n\n")}\n\n${notes.join(" ")}`;
}
