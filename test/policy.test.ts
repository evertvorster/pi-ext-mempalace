import { describe, expect, test } from "bun:test";
import {
  closestName,
  isBoundaryInstant,
  isCaptureOnly,
  isFromSession,
  MAINTAIN_TASKS,
  normalizeName,
  pluralEquivalent,
  resolveEntity,
  resolveIn,
  typeFromContent,
} from "../policy.ts";

describe("typeFromContent", () => {
  test("reads a type header", () => {
    expect(typeFromContent("type: decision\ndate: 2026-11-02")).toBe("decision");
    expect(typeFromContent("type: Project_Fact\nfoo")).toBe("project_fact");
  });

  test("is not fooled by a mid-line mention", () => {
    expect(typeFromContent("the stored type: decision field")).toBeUndefined();
    expect(typeFromContent("no header here")).toBeUndefined();
  });
});

describe("normalizeName", () => {
  test("folds case, spaces, underscores and repeated hyphens", () => {
    expect(normalizeName("Project_Facts")).toBe("project-facts");
    expect(normalizeName("  Space Sim ")).toBe("space-sim");
    expect(normalizeName("open--loops-")).toBe("open-loops");
  });
});

describe("pluralEquivalent", () => {
  test("accepts the singular and the plural", () => {
    expect(pluralEquivalent("decisions", "decision")).toBe(true);
    expect(pluralEquivalent("decision", "decisions")).toBe(true);
    expect(pluralEquivalent("decision", "decide")).toBe(false);
  });
});

describe("closestName", () => {
  test("finds a typo within the distance budget", () => {
    expect(closestName("decisons", ["decisions", "project-facts"])).toBe("decisions");
  });

  test("says nothing for an equivalent spelling — that is a rewrite, not a typo", () => {
    expect(closestName("decisions", ["decisions"])).toBeUndefined();
  });

  test("says nothing for an unrelated name", () => {
    expect(closestName("calibre-plugin", ["decisions", "shaders"])).toBeUndefined();
  });
});

describe("resolveIn", () => {
  const rooms: Array<[string, number]> = [
    ["project-facts", 169],
    ["project_facts", 5],
    ["decisions", 300],
    ["shaders", 248],
  ];

  test("an exact match passes untouched", () => {
    expect(resolveIn("decisions", rooms, "Room", "")).toEqual({ kind: "ok", value: "decisions" });
  });

  test("a mechanical variant is rewritten to the populated spelling", () => {
    expect(resolveIn("project_facts", rooms, "Room", "")).toEqual({
      kind: "ok",
      value: "project-facts",
      rewritten: "project-facts",
    });
  });

  test("a plural resolves to the singular room", () => {
    expect(resolveIn("decision", rooms, "Room", "")).toEqual({
      kind: "ok",
      value: "decisions",
      rewritten: "decisions",
    });
  });

  test("a typo is blocked and names the likely target", () => {
    const result = resolveIn("decisons", rooms, "Room", ' in wing "evert"');
    expect(result.kind).toBe("blocked");
    if (result.kind !== "blocked") throw new Error("unreachable");
    expect(result.message).toContain('Did you mean "decisions"?');
    expect(result.message).toContain('in wing "evert"');
    expect(result.message).toContain("decisions");
  });

  test("a genuinely new name is allowed", () => {
    expect(resolveIn("brand-new-topic", rooms, "Room", "")).toEqual({ kind: "new", value: "brand-new-topic" });
  });
});

describe("resolveEntity", () => {
  const entities = ["Evert Vorster", "SpaceSim", "pi", "Evert Vorster (nephew)"];

  test("an exact match passes", () => {
    expect(resolveEntity("SpaceSim", entities)).toEqual({ kind: "ok", value: "SpaceSim" });
  });

  test("a case variant resolves to the existing spelling", () => {
    expect(resolveEntity("spacesim", entities)).toEqual({ kind: "ok", value: "SpaceSim", rewritten: "SpaceSim" });
  });

  test("an abbreviation is blocked rather than forking a node", () => {
    const result = resolveEntity("Evert", entities);
    expect(result.kind).toBe("blocked");
    if (result.kind !== "blocked") throw new Error("unreachable");
    expect(result.message).toContain("abbreviation");
    expect(result.message).toContain("Evert Vorster");
  });

  test("a typo is blocked with the correct name offered", () => {
    const result = resolveEntity("Space Sim", entities);
    expect(result.kind).toBe("blocked");
    if (result.kind !== "blocked") throw new Error("unreachable");
    expect(result.message).toContain("SpaceSim");
  });

  test("a new entity is allowed", () => {
    expect(resolveEntity("Cladogenesis", entities)).toEqual({ kind: "new", value: "Cladogenesis" });
  });
});

describe("isFromSession", () => {
  const id = "2026-11-02T08-55-18-048Z_01a19b78.jsonl";

  test("matches the session id in the source path or the text", () => {
    expect(isFromSession({ source_file: `/sessions/${id}` }, id)).toBe(true);
    expect(isFromSession({ text: `captured from ${id}` }, id)).toBe(true);
  });

  test("ignores other sessions, and everything when there is no id", () => {
    expect(isFromSession({ source_file: "/sessions/other.jsonl" }, id)).toBe(false);
    expect(isFromSession({ source_file: id }, "")).toBe(false);
  });
});

describe("isCaptureOnly", () => {
  test("capture rooms only", () => {
    expect(isCaptureOnly(["transcripts"])).toBe(true);
    expect(isCaptureOnly(["transcripts", "diary"])).toBe(true);
    expect(isCaptureOnly(["transcripts", "decisions"])).toBe(false);
    expect(isCaptureOnly([])).toBe(false);
  });
});

describe("isBoundaryInstant", () => {
  test("accepts a date or a UTC instant", () => {
    expect(isBoundaryInstant("2026-11-02")).toBe(true);
    expect(isBoundaryInstant("2026-11-02T00:00:00Z")).toBe(true);
    expect(isBoundaryInstant("2026-11-02T00:00:00+00:00")).toBe(true);
  });

  test("rejects a partial date or a local time", () => {
    expect(isBoundaryInstant("2026-11")).toBe(false);
    expect(isBoundaryInstant("2026-11-02 10:00")).toBe(false);
    expect(isBoundaryInstant("2026-11-02T10:00:00+02:00")).toBe(false);
  });
});

describe("MAINTAIN_TASKS", () => {
  test("offers exactly the two palace-wide passes", () => {
    expect([...MAINTAIN_TASKS]).toEqual(["orphans", "closets"]);
  });
});
