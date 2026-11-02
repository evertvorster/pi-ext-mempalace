import { describe, expect, test } from "bun:test";
import { dedupeResults, renderKgQuery, renderListDrawers, renderSearch } from "../render.ts";

const hit = (over: Record<string, unknown> = {}) => ({
  wing: "pi",
  room: "decisions",
  similarity: 0.52,
  drawer_id: "drawer_a",
  text: "type: decision\nsummary: something",
  ...over,
});

describe("dedupeResults", () => {
  test("collapses two chunks of the same drawer", () => {
    const { kept, dropped } = dedupeResults([hit(), hit({ text: "second chunk of the same drawer" })]);
    expect(kept).toHaveLength(1);
    expect(dropped).toBe(1);
  });

  test("collapses repeats by opening text when there is no id", () => {
    const shared = "type: decision\n" + "y".repeat(200);
    const { kept, dropped } = dedupeResults([
      hit({ drawer_id: undefined, text: shared }),
      hit({ drawer_id: undefined, text: `${shared} and a different tail` }),
    ]);
    expect(kept).toHaveLength(1);
    expect(dropped).toBe(1);
  });

  test("keeps distinct drawers", () => {
    const { kept, dropped } = dedupeResults([hit(), hit({ drawer_id: "drawer_b" })]);
    expect(kept).toHaveLength(2);
    expect(dropped).toBe(0);
  });
});

describe("renderKgQuery", () => {
  test("groups current facts by predicate and counts ended ones", () => {
    const rendered = renderKgQuery(
      {
        facts: [
          { predicate: "child", object: "Aiden", current: true },
          { predicate: "child", object: "Ethen", current: true },
          { predicate: "spouse", object: "Isolde", current: true },
          { predicate: "maintains", object: "coqui-tts", current: false },
        ],
      },
      "Evert Vorster",
    );
    expect(rendered).toContain('"Evert Vorster" — 3 current facts');
    expect(rendered).toContain("child: Aiden, Ethen");
    expect(rendered).toContain("spouse: Isolde");
    expect(rendered).not.toContain("coqui-tts");
    expect(rendered).toContain("(1 ended fact hidden)");
  });

  test("truncates a long predicate list", () => {
    const facts = Array.from({ length: 11 }, (_, i) => ({ predicate: "maintains", object: `pkg${i}`, current: true }));
    const rendered = renderKgQuery({ facts }, "Evert Vorster") ?? "";
    expect(rendered).toContain("(+3 more)");
    expect(rendered).toContain("11 current facts");
  });

  test("says so when nothing is current", () => {
    const rendered = renderKgQuery({ facts: [{ predicate: "maintains", object: "x", current: false }] }, "pi");
    expect(rendered).toBe('No current facts for "pi" (1 ended).');
  });

  test("declines when the payload is not a fact list", () => {
    expect(renderKgQuery(null, "pi")).toBeUndefined();
    expect(renderKgQuery({ entity: "pi" }, "pi")).toBeUndefined();
  });
});

describe("renderListDrawers", () => {
  test("states the page size and points at each drawer", () => {
    const rendered = renderListDrawers({
      total: 22,
      drawers: [
        {
          drawer_id: "drawer_pi_open-loops_1",
          wing: "pi",
          room: "open-loops",
          content_preview: "type: open_loop\nsummary: something pending",
          metadata: { source_file: "/home/evert/.pi/sessions/x.jsonl" },
        },
      ],
    });
    expect(rendered).toContain("showing 1 of 22");
    expect(rendered).toContain("drawer_pi_open-loops_1  pi/open-loops");
    expect(rendered).toContain("src: /home/evert/.pi/sessions/x.jsonl");
  });

  test("handles an empty page", () => {
    expect(renderListDrawers({ total: 0, drawers: [] })).toBe("No drawers (total 0).");
  });
});

describe("renderSearch", () => {
  const sessionFile = "/home/evert/.pi/agent/sessions/--home-evert--/2026-11-02T08-55-18-048Z_01a19b78.jsonl";
  const sessionId = "2026-11-02T08-55-18-048Z_01a19b78.jsonl";
  const noBroaden = { broaden: false };

  test("explains an empty result instead of leaving a blank box", async () => {
    const rendered = await renderSearch({ results: [] }, "anything", sessionFile, noBroaden);
    expect(rendered).toContain("No results for: anything");
    expect(rendered).toContain("mempalace_list_rooms");
  });

  test("hides hits from the session doing the searching", async () => {
    const rendered =
      (await renderSearch(
        { results: [hit({ source_file: `/sessions/${sessionId}` }), hit({ drawer_id: "drawer_b" })] },
        "question",
        sessionFile,
        noBroaden,
      )) ?? "";
    expect(rendered).toContain("1 hit from this session hidden");
    expect(rendered).not.toContain("drawer_a");
    expect(rendered).toContain("drawer_b");
  });

  test("says plainly when everything was this session", async () => {
    const rendered =
      (await renderSearch({ results: [hit({ source_file: `/sessions/${sessionId}` })] }, "q", sessionFile, noBroaden)) ??
      "";
    expect(rendered).toContain("No results outside this session for: q");
  });

  test("labels a capture-only result as archive, not knowledge", async () => {
    const rendered =
      (await renderSearch(
        { results: [hit({ room: "transcripts", drawer_id: "d1" }), hit({ room: "diary", drawer_id: "d2" })] },
        "q",
        sessionFile,
        noBroaden,
      )) ?? "";
    expect(rendered).toContain("raw capture, not filed memory");
  });

  test("points at get_drawer when a hit is a truncated preview", async () => {
    const rendered =
      (await renderSearch(
        { results: [hit({ text: "x".repeat(800) })] },
        "q",
        sessionFile,
        noBroaden,
      )) ?? "";
    expect(rendered).toContain("800-character previews");
  });

  test("carries the drawer id and the similarity into every hit", async () => {
    const rendered = (await renderSearch({ results: [hit()] }, "q", sessionFile, noBroaden)) ?? "";
    expect(rendered).toContain("pi/decisions sim=0.52");
    expect(rendered).toContain("id=drawer_a");
  });
});
