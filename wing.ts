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
