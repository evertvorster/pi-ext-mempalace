/**
 * cwd → wings.
 *
 * The wake-up reads the wings this resolves to, so a wrong answer is not a
 * cosmetic bug: `/home/evert` derived `evert`, a 19k-drawer grab-bag, and its
 * wake-up came back as thirteen raw transcript chunks. The map is config
 * (`~/.mempalace/pi-wings.json`), and these tests pin the matching rules:
 * longest prefix wins, prefixes are segment-aware, and an unmatched cwd falls
 * back to the derived wing rather than to silence.
 */

import { describe, expect, test } from "bun:test";
import { sanitizeWingName, wingsForCwd, type WingMap } from "../wing.ts";

const map: WingMap = {
  identityWing: "dora",
  defaults: ["dora"],
  paths: {
    "/home/evert": ["pi", "notes-vault"],
    "/home/evert/Software/Projects/SpaceSim": ["SpaceSim"],
    "/home/evert/Insync": ["notes-vault"],
  },
};

describe("wingsForCwd", () => {
  test("longest prefix wins", () => {
    expect(wingsForCwd("/home/evert/Software/Projects/SpaceSim", map)).toEqual(["SpaceSim", "dora"]);
  });

  test("includes the defaults, in map order", () => {
    expect(wingsForCwd("/home/evert", map)).toEqual(["pi", "notes-vault", "dora"]);
  });

  test("a prefix is segment-aware, not a string prefix", () => {
    // /home/evertXYZ must not match /home/evert
    expect(wingsForCwd("/home/evertXYZ", map)).toEqual(["evertXYZ", "dora"]);
  });

  test("trailing slashes do not change the answer", () => {
    expect(wingsForCwd("/home/evert/Software/Projects/SpaceSim/", map)).toEqual(["SpaceSim", "dora"]);
  });

  test("an unmatched cwd falls back to the derived wing", () => {
    expect(wingsForCwd("/srv/other-project", map)).toEqual(["other-project", "dora"]);
  });

  test("no map at all still yields something to read", () => {
    expect(wingsForCwd("/home/evert/Software/Projects/SpaceSim", null)).toEqual(["SpaceSim"]);
  });

  test("duplicates collapse", () => {
    const overlapping: WingMap = { defaults: ["dora"], paths: { "/home/evert": ["dora", "pi"] } };
    expect(wingsForCwd("/home/evert", overlapping)).toEqual(["dora", "pi"]);
  });
});

describe("sanitizeWingName", () => {
  test("keeps case and hyphens, replaces the rest", () => {
    expect(sanitizeWingName("Vega-Strike Engine")).toBe("Vega-Strike_Engine");
  });
});
