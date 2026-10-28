// 顺序干跑模拟：把整棵 aiBase 的目标文件读进内存，按 ALL_PATCHES 顺序逐个应用，
// 完全复刻 applyPatches() 的判定，但不写盘。用于判断"0.2.1 上还有哪些补丁打不动"。
// 用法: node tools/sim.mjs <pluginRoot> <aiBase> [dshHome] [--json out.json] [--only ids]
import path from "node:path";
import fs from "node:fs";

const pluginRoot = process.argv[2];
const aiBase = process.argv[3];
const dshHome = process.argv[4] && !process.argv[4].startsWith("--") ? process.argv[4] : (process.env.DSH_HOME || ".dsh");
const jsonIdx = process.argv.indexOf("--json");
const jsonOut = jsonIdx > 0 ? process.argv[jsonIdx + 1] : "";
const onlyIdx = process.argv.indexOf("--only");
const only = onlyIdx > 0 ? new Set(process.argv[onlyIdx + 1].split(",").map(Number)) : null;

process.env.DSH_HOME = dshHome;
process.env.DSH_SURFACE = process.env.DSH_SURFACE || "web";
const core = await import(new URL("file:///" + path.join(pluginRoot, "lib", "core.js").replace(/\\/g, "/")).href);

/* 与 core.js:6692-6752 逐字同源：patchApplied / patchHasRemainingWork / filePatchSettled */
function asLf(t) { return typeof t === "string" ? t.replace(/\r\n/g, "\n") : t; }
function matchesPattern(hay, pattern) {
  if (pattern instanceof RegExp) return new RegExp(pattern.source, String(pattern.flags || "").replace("g", "")).test(hay);
  return hay.includes(asLf(pattern));
}
function patchReplacements(p) {
  if (Array.isArray(p.replacements)) return p.replacements;
  return (p.patterns ?? []).map((pat) => ({ pattern: pat, replace: p.replace }));
}
function isIdentityLayoutPatch(p) { return Boolean(p && (p.id === 4 || p.id === 25 || p.id === 26)); }
function isApprovalSentencePatch(p) { return Boolean(p && (p.id === 5 || p.id === 11 || p.id === 12)); }
function isLayoutSoftPatch(p) { return isIdentityLayoutPatch(p) || isApprovalSentencePatch(p) || Boolean(p?.softSettle); }
function isYamlPath(fp) { return /\.ya?ml$/i.test(String(fp || "")); }
function isBareIdentityNeedle(pattern) {
  const needle = asLf(pattern);
  if (!needle) return false;
  if (/^[ \t]/.test(needle)) return false;
  return /^You are a coding agent powered by\b/.test(needle);
}
function patchApplied(text, patch) {
  const hay = asLf(text);
  if (Array.isArray(patch?.forbid) && patch.forbid.some((m) => hay.includes(asLf(m)))) return false;
  if (Array.isArray(patch.markers) && patch.markers.length > 0) {
    const match = patch.markersAny ? "some" : "every";
    return patch.markers[match]((m) => hay.includes(asLf(m)));
  }
  if (patch.marker) return hay.includes(asLf(patch.marker));
  if (typeof patch.replace === "string" && patch.replace.length > 0) {
    return hay.includes(asLf(patch.replace).split("\n")[0].slice(0, 60));
  }
  return false;
}
function patchHasRemainingWork(text, patch, fp = "") {
  const hay = asLf(text);
  const yaml = isYamlPath(fp);
  for (const { pattern, replace } of patchReplacements(patch)) {
    if (!pattern || typeof replace !== "string") continue;
    if (yaml && isBareIdentityNeedle(pattern)) continue;
    if (matchesPattern(hay, pattern)) return true;
  }
  return false;
}
function filePatchSettled(text, patch, fp = "") {
  if (patchApplied(text, patch)) return true;
  if (isLayoutSoftPatch(patch)) return !patchHasRemainingWork(text, patch, fp);
  return false;
}
/* -------------------------------------------------------------------------- */

const files = core.targetFiles(aiBase, dshHome);
const disk = new Map(); // fp -> 当前内存文本
function textOf(fp) {
  if (!disk.has(fp)) disk.set(fp, fs.readFileSync(fp, "utf8"));
  return disk.get(fp);
}
function pathsOf(key) {
  const raw = files[key];
  const arr = (Array.isArray(raw) ? raw : [raw]).filter(Boolean);
  return arr.filter((f) => fs.existsSync(f));
}

const rows = [];
const failures = [];
for (const p of core.ALL_PATCHES) {
  if (only && !only.has(p.id)) continue;
  if (!core.patchAppliesHere(p)) { rows.push({ id: p.id, name: p.name, status: "na" }); continue; }
  const keys = Array.isArray(p.file) ? p.file : [p.file];
  let applied = 0, already = 0, missing = 0, notFound = 0;
  const touched = [];
  for (const key of keys) {
    const fps = pathsOf(key);
    if (fps.length === 0) { missing += 1; continue; }
    for (const fp of fps) {
      const text = textOf(fp);
      let res;
      try { res = core.applyReplacementsToText(text, p, fp); }
      catch (e) { notFound += 1; failures.push({ id: p.id, key, fp, err: String(e.message) }); continue; }
      if (res.changed) { disk.set(fp, res.text); applied += 1; touched.push(path.relative(aiBase, fp)); }
      else {
        if (filePatchSettled(text, p, fp)) already += 1;
        else notFound += 1;
      }
    }
  }
  let status;
  if (applied > 0) status = "applied";
  else if (already > 0 && (notFound === 0 || p.softSettle || p.optional)) status = "already";
  else if (missing === keys.length) status = "missing_file";
  else if (notFound === 0) status = "skipped";
  else status = "pattern_not_found";
  rows.push({ id: p.id, name: p.name, status, applied, already, missing, notFound, touched, optional: !!p.optional, strictFiles: !!p.strictFiles });
}

const out = { aiBase, rows };
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(out, null, 2), "utf8");

const sum = {};
for (const r of rows) sum[r.status] = (sum[r.status] || 0) + 1;
console.log(`aiBase = ${aiBase}`);
console.log(`status: ${Object.entries(sum).map(([k, v]) => `${k}=${v}`).join("  ")}  (total ${rows.length})`);
const bad = rows.filter((r) => r.status === "pattern_not_found" || r.status === "skipped" || r.status === "missing_file");
console.log(`\n##### 打不动 (${bad.length}) #####`);
for (const r of bad) {
  console.log(`#${r.id} ${r.name}  [${r.status}]${r.strictFiles ? " strict" : ""}${r.optional ? " opt" : ""} applied=${r.applied} already=${r.already} notFound=${r.notFound} missing=${r.missing}`);
}
const ok = rows.filter((r) => r.status === "applied");
console.log(`\n##### 已应用 (${ok.length}) #####`);
for (const r of ok) console.log(`#${r.id} ${r.name} -> ${r.touched.join(", ") || "(no path)"}`);
