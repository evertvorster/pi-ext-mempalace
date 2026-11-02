/**
 * Python plumbing — every call into MemPalace goes through here.
 *
 * Two ways in:
 *
 *  - `runBridge` calls the package's own `scripts/bridge.py`, which dispatches a
 *    command name straight into `mempalace.mcp_server.tool_*`.
 *  - `runHelper` runs one of the helper scripts in `scripts/`, for the few jobs
 *    that need more Python than a single tool call (search-then-summarise, an
 *    atomic triple+drawer write, a closet rebuild).
 *
 * Both write their JSON to a file rather than a pipe: importing
 * `mempalace.mcp_server` performs stdio protection — it redirects fd 1 to
 * stderr (`os.dup2(2, 1)`) — so a helper's stdout cannot be trusted to carry
 * the payload.
 */

import { execFile } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const here = dirname(fileURLToPath(import.meta.url));
const bridgeScript = join(here, "scripts", "bridge.py");

/** Helper scripts and the env var each one writes its result to. */
const HELPERS: Record<string, { path: string; env: string }> = {
  "kg_supersede.py": { path: join(here, "scripts", "kg_supersede.py"), env: "KG_SUPERSEDE_OUTPUT" },
  "fact.py": { path: join(here, "scripts", "fact.py"), env: "KG_FACT_OUTPUT" },
  "coverage.py": { path: join(here, "scripts", "coverage.py"), env: "KG_COVERAGE_OUTPUT" },
  "orphans.py": { path: join(here, "scripts", "orphans.py"), env: "KG_ORPHANS_OUTPUT" },
  "closets_rebuild.py": { path: join(here, "scripts", "closets_rebuild.py"), env: "KG_CLOSETS_OUTPUT" },
  "wake.py": { path: join(here, "scripts", "wake.py"), env: "KG_WAKE_OUTPUT" },
};

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function tempFile(label: string): string {
  return join(tmpdir(), `pi-mempalace-${label}-${process.pid}-${randomUUID()}.json`);
}

/** Last JSON line of a result file, or undefined when it is missing or empty. */
function readPayload(file: string): any {
  if (!existsSync(file)) return undefined;
  const line = readFileSync(file, "utf8").trim().split(/\r?\n/).filter(Boolean).at(-1);
  if (!line) return undefined;
  return JSON.parse(line);
}

/** Run a bridge command and return its `data` payload, throwing with detail on failure. */
export async function runBridge(
  command: string,
  payload: Record<string, unknown> = {},
  signal?: AbortSignal,
): Promise<any> {
  const outputFile = tempFile(command);
  let stdout = "";
  let stderr = "";
  try {
    const result = await execFileAsync("/usr/bin/python", [bridgeScript, command, JSON.stringify(payload)], {
      signal,
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, MEMPALACE_BRIDGE_OUTPUT: outputFile },
    });
    stdout = result.stdout ?? "";
    stderr = result.stderr ?? "";
  } catch (error: any) {
    stdout = error?.stdout ?? "";
    stderr = error?.stderr ?? "";
    if (!existsSync(outputFile)) {
      throw new Error(
        `mempalace bridge failed (${command}, code=${error?.code ?? "unknown"}, killed=${error?.killed ?? false})\n` +
          `stdout:\n${stdout}\nstderr:\n${stderr}\n${errorText(error)}`,
      );
    }
  }

  const fileOutput = existsSync(outputFile) ? readFileSync(outputFile, "utf8") : "";
  rmSync(outputFile, { force: true });
  const jsonLine = (fileOutput || stdout).trim().split(/\r?\n/).filter(Boolean).at(-1);
  if (!jsonLine) {
    throw new Error(`mempalace bridge produced no JSON (${command})\nstdout:\n${stdout}\nstderr:\n${stderr}`);
  }
  let parsed: any;
  try {
    parsed = JSON.parse(jsonLine);
  } catch (error) {
    throw new Error(
      `mempalace bridge returned invalid JSON (${command}): ${errorText(error)}\nlast line:\n${jsonLine}\n` +
        `stdout:\n${stdout}\nstderr:\n${stderr}`,
    );
  }
  if (!parsed.ok) throw new Error(`${parsed.error ?? "mempalace bridge returned ok=false"}\n${parsed.details ?? ""}`);
  return parsed.data;
}

/** Run one of the helper scripts and return its `data` payload, throwing with its message. */
export async function runHelper(
  script: string,
  payload: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<any> {
  const helper = HELPERS[script];
  if (!helper) throw new Error(`unknown helper script: ${script}`);

  const outFile = tempFile(script.replace(/\W/g, ""));
  let stdout = "";
  let stderr = "";
  try {
    const result = await execFileAsync("/usr/bin/python", [helper.path, JSON.stringify(payload)], {
      signal,
      timeout: 120_000,
      maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, [helper.env]: outFile },
    });
    stdout = result.stdout ?? "";
    stderr = result.stderr ?? "";
  } catch (error) {
    // The helper exits non-zero for `ok: false`; the payload is still in the file.
    stdout = (error as { stdout?: string }).stdout ?? "";
    stderr = (error as { stderr?: string }).stderr ?? "";
    if (!existsSync(outFile) && !stdout.trim()) {
      throw new Error(
        `${script} failed to run: ${errorText(error)}` + (stderr ? `\nstderr:\n${stderr.trim().slice(0, 1000)}` : ""),
      );
    }
  }

  const fileOutput = existsSync(outFile) ? readFileSync(outFile, "utf8") : "";
  rmSync(outFile, { force: true });

  const line = (fileOutput || stdout).trim().split(/\r?\n/).filter(Boolean).at(-1);
  if (!line) {
    throw new Error(`${script} produced no output${stderr ? `\nstderr:\n${stderr.trim().slice(0, 1000)}` : ""}`);
  }
  let parsed: any;
  try {
    parsed = JSON.parse(line);
  } catch (error) {
    throw new Error(`${script} returned invalid JSON: ${errorText(error)}\nlast line:\n${line.slice(0, 1000)}`);
  }
  if (!parsed?.ok) throw new Error(String(parsed?.error ?? `${script} reported failure`));
  return parsed.data;
}

const CACHE_TTL_MS = 60_000;
const KG_PAGE = 100;

export type Taxonomy = Record<string, Record<string, number>>;

let taxonomyCache: { at: number; data: Taxonomy } | null = null;
let entityCache: { at: number; data: string[] } | null = null;

/** wing → room → drawer count, as the palace currently reports it. */
export async function loadTaxonomy(): Promise<Taxonomy | null> {
  if (taxonomyCache && Date.now() - taxonomyCache.at < CACHE_TTL_MS) return taxonomyCache.data;
  try {
    const data = await runBridge("get_taxonomy", {});
    const taxonomy = data?.taxonomy ?? data;
    if (!taxonomy || typeof taxonomy !== "object") return null;
    taxonomyCache = { at: Date.now(), data: taxonomy as Taxonomy };
    return taxonomy as Taxonomy;
  } catch {
    return null;
  }
}

/** Entity names already in the knowledge graph, collected from paged kg_timeline. */
export async function loadEntities(): Promise<string[] | null> {
  if (entityCache && Date.now() - entityCache.at < CACHE_TTL_MS) return entityCache.data;

  const names = new Set<string>();
  for (let offset = 0; offset < 2000; offset += KG_PAGE) {
    let page: any[] | undefined;
    try {
      const data = await runBridge("kg_timeline", { limit: KG_PAGE, offset });
      page = data?.timeline;
    } catch {
      break;
    }
    if (!Array.isArray(page) || page.length === 0) break;
    for (const fact of page) {
      if (typeof fact?.subject === "string") names.add(fact.subject);
      if (typeof fact?.object === "string") names.add(fact.object);
    }
    if (page.length < KG_PAGE) break;
  }

  if (names.size === 0) return null;
  entityCache = { at: Date.now(), data: [...names] };
  return [...names];
}
