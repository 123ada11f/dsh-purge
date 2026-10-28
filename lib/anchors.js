/**
 * 锚点覆盖表（anchor overrides）：宿主升级让某条替换的锚点文本变了，
 * 与其改代码发版，不如把新锚点连同时间戳/宿主版本落到磁盘，下次打补丁直接读。
 *
 * 数据文件：`<DSH_HOME>/dsh-purge/anchor-overrides.json`
 * 形状：`{ "<patchId>": { "<replacementIndex>": { pattern, at, host } } }`
 *
 * 本文件**不 import core.js**（core 会 import 本文件，避免循环依赖），
 * home 由调用方传入；不传时按 `DSH_HOME` 环境变量或 `~/.dsh` 自行解析。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const OVERRIDES_FILE = "anchor-overrides.json";

/** @returns the DSH home directory to read overrides from. */
export function resolveOverrideHome(home) {
  if (typeof home === "string" && home.trim()) return path.resolve(home.trim());
  const env = process.env.DSH_HOME;
  if (typeof env === "string" && env.trim()) return path.resolve(env.trim());
  return path.join(os.homedir(), ".dsh");
}

/** @returns the overrides file path under one DSH home. */
export function overridesPath(home) {
  return path.join(resolveOverrideHome(home), "dsh-purge", OVERRIDES_FILE);
}

/**
 * Read the override table.
 * @returns `{}` when the file is absent, empty, or unparsable — a broken table
 *          must degrade to "same anchors as the source code", never throw.
 */
export function readOverrides(home) {
  const file = overridesPath(home);
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return {};
  }
  if (!text.trim()) return {};
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const out = {};
  for (const [patchId, rows] of Object.entries(parsed)) {
    if (!rows || typeof rows !== "object" || Array.isArray(rows)) continue;
    const kept = {};
    for (const [index, row] of Object.entries(rows)) {
      if (!row || typeof row !== "object") continue;
      const pattern = row.pattern;
      if (typeof pattern !== "string" || !pattern) continue;
      kept[index] = {
        pattern,
        at: typeof row.at === "string" ? row.at : "",
        host: typeof row.host === "string" ? row.host : "",
      };
    }
    if (Object.keys(kept).length) out[patchId] = kept;
  }
  return out;
}

function writeTable(home, table) {
  const file = overridesPath(home);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, `${JSON.stringify(table, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

/**
 * Record one new anchor pattern for a patch replacement.
 * @param index - 0-based index into the patch's replacement list.
 * @param pattern - the literal (or RegExp source) that now exists in the host.
 * @returns the whole table after the write.
 */
export function writeOverride(home, patchId, index, pattern, extra = {}) {
  const table = readOverrides(home);
  const key = String(patchId);
  const slot = String(index);
  const row = {
    pattern: String(pattern),
    at: new Date().toISOString(),
    host: typeof extra.host === "string" ? extra.host : "",
  };
  table[key] = { ...(table[key] || {}), [slot]: row };
  writeTable(home, table);
  return table;
}

/**
 * Drop one anchor override (or the whole patch entry when `index` is omitted).
 * @returns the whole table after the write.
 */
export function clearOverride(home, patchId, index) {
  const table = readOverrides(home);
  const key = String(patchId);
  if (!table[key]) return table;
  if (index === undefined || index === null) {
    delete table[key];
  } else {
    delete table[key][String(index)];
    if (!Object.keys(table[key]).length) delete table[key];
  }
  writeTable(home, table);
  return table;
}

/**
 * Apply the recorded anchors of one patch.
 * @param patch - a patch row carrying `id`, `replacements` and/or `patterns`.
 * @param overrides - the table from `readOverrides`.
 * @returns `{ patch, applied }`; `applied` counts the replaced entries.
 *          The input patch object is never mutated.
 */
export function applyOverrides(patch, overrides) {
  if (!patch || !overrides) return { patch, applied: 0 };
  const rows = overrides[String(patch.id)];
  if (!rows || typeof rows !== "object") return { patch, applied: 0 };
  const indexes = Object.keys(rows)
    .map((key) => Number.parseInt(key, 10))
    .filter((n) => Number.isInteger(n) && n >= 0);
  if (!indexes.length) return { patch, applied: 0 };

  const patchWith = (list, field) => {
    if (!Array.isArray(list)) return null;
    const copy = list.slice();
    let applied = 0;
    for (const index of indexes) {
      if (index >= copy.length) continue;
      const row = rows[String(index)];
      if (!row || typeof row.pattern !== "string") continue;
      const current = copy[index];
      const next = Array.isArray(current)
        ? [row.pattern, current[1], ...current.slice(2)]
        : current && typeof current === "object"
          ? { ...current, pattern: row.pattern }
          : row.pattern;
      copy[index] = next;
      applied += 1;
    }
    return applied ? { list: copy, applied } : null;
  };

  const replacements = patchWith(patch.replacements, "replacements");
  const patterns = patchWith(patch.patterns, "patterns");
  const hit = replacements || patterns;
  if (!hit) return { patch, applied: 0 };
  const next = { ...patch };
  if (replacements) next.replacements = replacements.list;
  if (patterns) next.patterns = patterns.list;
  return { patch: next, applied: replacements ? replacements.applied : patterns.applied };
}
