/**
 * Wing resolution from a working directory.
 *
 * The nearest ancestor `mempalace.yaml` with a `wing:` line is authoritative;
 * otherwise the directory name, with characters outside `[A-Za-z0-9_-]` replaced
 * by `_`. Case and hyphens survive, which `mempalace mine` does not do — it
 * lowercases and turns `-` into `_`. That asymmetry is why a project without a
 * pinned wing ends up with two wings, so any project whose directory name differs
 * from its intended wing must be pinned.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, parse } from "node:path";

export function sanitizeWingName(value: string): string {
  return (
    value
      .trim()
      .replace(/[^A-Za-z0-9_-]+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "") || "general"
  );
}

export function detectWing(cwd: string): string | undefined {
  let dir = cwd;
  while (true) {
    const config = join(dir, "mempalace.yaml");
    if (existsSync(config)) {
      const text = readFileSync(config, "utf8");
      const match = text.match(/^wing:\s*["']?([^"'\n#]+)["']?\s*$/m);
      if (match) return match[1].trim();
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

export function defaultWing(cwd: string): string {
  return detectWing(cwd) ?? sanitizeWingName(parse(cwd).name);
}

/**
 * cwd → wings, from `~/.mempalace/pi-wings.json`.
 *
 * A derived wing is right for a project directory and wrong for a home
 * directory: `/home/evert` derives `evert`, a 19k-drawer grab-bag of transcripts,
 * old projects and other people's configs, so its wake-up was 13 raw transcript
 * chunks. The map lets that be a decision rather than a guess, and it lives with
 * the palace it queries so it can be edited without a rebuild.
 *
 * {
 *   "identityWing": "dora",
 *   "defaults": ["dora"],
 *   "paths": { "/home/evert": ["pi", "dora", "notes-vault"] }
 * }
 */
export type WingMap = {
  identityWing?: string;
  defaults?: string[];
  paths?: Record<string, string[]>;
};

export const WING_MAP_PATH = join(homedir(), ".mempalace", "pi-wings.json");

export function loadWingMap(path: string = WING_MAP_PATH): WingMap | null {
  try {
    if (!existsSync(path)) return null;
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return parsed && typeof parsed === "object" ? (parsed as WingMap) : null;
  } catch {
    return null; // a broken map must not take session start down with it
  }
}

/** Longest matching path prefix wins; `defaults` are always included. */
export function wingsForCwd(cwd: string, map: WingMap | null = loadWingMap()): string[] {
  const wings: string[] = [];
  const add = (wing: string | undefined) => {
    if (wing && !wings.includes(wing)) wings.push(wing);
  };

  const normal = cwd.replace(/\/+$/, "") || "/";
  let best: { prefix: string; wings: string[] } | null = null;
  for (const [prefix, value] of Object.entries(map?.paths ?? {})) {
    if (!Array.isArray(value)) continue;
    const clean = prefix.replace(/\/+$/, "") || "/";
    const matches = normal === clean || normal.startsWith(clean === "/" ? "/" : `${clean}/`);
    if (matches && (!best || clean.length > best.prefix.length)) best = { prefix: clean, wings: value };
  }

  for (const wing of best?.wings ?? []) add(wing);
  // No configured path for this directory — its own wing is still the honest answer.
  if (!best) add(defaultWing(cwd));
  for (const wing of map?.defaults ?? []) add(wing);
  if (wings.length === 0) add(defaultWing(cwd));
  return wings;
}
