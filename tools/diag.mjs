// dsh-purge 迁移诊断（干跑）：
// 对给定 aiBase，用真实的 applyReplacementsToText() 在"出厂原文"上模拟应用，
// 报告每个补丁会不会真的改到文件、锚点是否还在。
// 用法: node tools/diag.mjs <pluginRoot> <aiBase> [dshHome] [--bak] [--json out.json]
import path from "node:path";
import fs from "node:fs";

const pluginRoot = process.argv[2];
const aiBase = process.argv[3];
const dshHome = process.argv[4] && !process.argv[4].startsWith("--") ? process.argv[4] : (process.env.DSH_HOME || ".dsh");
const jsonIdx = process.argv.indexOf("--json");
const jsonOut = jsonIdx > 0 ? process.argv[jsonIdx + 1] : "";
const USE_BAK = process.argv.includes("--bak");
const SHOW_OK = process.argv.includes("--show-ok");

process.env.DSH_HOME = dshHome;
process.env.DSH_SURFACE = process.env.DSH_SURFACE || "web";

const url = new URL("file:///" + path.join(pluginRoot, "lib", "core.js").replace(/\\/g, "/"));
const core = await import(url.href);

/* ---- 与 lib/core.js 同源的判定逻辑（此处必须逐字一致，见 core.js:6692-6759） ---- */
function asLf(t) { return typeof t === "string" ? t.replace(/\r\n/g, "\n") : t; }
function cloneRegExp(p, g) {
  let flags = String(p.flags || "").replace("g", "");
  if (g) flags += "g";
  return new RegExp(p.source, flags);
}
function matchesPattern(hay, pattern) {
  if (pattern instanceof RegExp) return cloneRegExp(pattern, false).test(hay);
  return hay.includes(asLf(pattern));
}
function patchReplacements(p) {
  if (Array.isArray(p.replacements)) return p.replacements;
  return (p.patterns ?? []).map((pat) => ({ pattern: pat, replace: p.replace }));
}
function isIdentityLayoutPatch(p) { return Boolean(p && (p.id === 4 || p.id === 25 || p.id === 26)); }
function isApprovalSentencePatch(p) { return Boolean(p && (p.id === 5 || p.id === 11 || p.id === 12)); }
function isLayoutSoftPatch(p) { return isIdentityLayoutPatch(p) || isApprovalSentencePatch(p) || Boolean(p?.softSettle); }
function isBareIdentityNeedle(pattern) {
  const needle = asLf(pattern);
  if (!needle) return false;
  if (/^[ \t]/.test(needle)) return false;
  return /^You are a coding agent powered by\b/.test(needle);
}
function isYamlPath(fp) { return /\.ya?ml$/i.test(String(fp || "")); }
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
/* ---------------------------------------------------------------------------- */

function fileKeysOf(p) { return Array.isArray(p.file) ? p.file : [p.file]; }
function readMaybeBak(fp) {
  if (USE_BAK) {
    try { if (fs.existsSync(fp + ".dshpurge.bak")) return fs.readFileSync(fp + ".dshpurge.bak", "utf8"); } catch { /* ignore */ }
  }
  return fs.readFileSync(fp, "utf8");
}
function snippet(s) { return String(s).replace(/\n/g, "\\n").slice(0, 120); }

const files = core.targetFiles(aiBase, dshHome);

const rows = [];
const details = {};
for (const p of core.ALL_PATCHES) {
  if (!core.patchAppliesHere(p)) { rows.push({ id: p.id, name: p.name, status: "na" }); continue; }
  const keys = fileKeysOf(p);
  let pending = 0, settled = 0, unchangeable = 0, nofile = 0;
  const info = [];
  for (const key of keys) {
    const raw = files[key];
    const fps = (Array.isArray(raw) ? raw : [raw]).filter(Boolean).filter((f) => fs.existsSync(f));
    if (fps.length === 0) { nofile += 1; info.push({ key, files: [], verdict: "no-file" }); continue; }
    for (const fp of fps) {
      const text = readMaybeBak(fp);
      let changed = false;
      try { changed = core.applyReplacementsToText(text, p, fp).changed; } catch (e) { info.push({ key, fp, verdict: "apply-error:" + e.message }); continue; }
      let verdict;
      if (changed) { verdict = "pending"; pending += 1; }
      else if (filePatchSettled(text, p, fp)) { verdict = "applied"; settled += 1; }
      else { verdict = "unmatched"; unchangeable += 1; }
      const miss = [];
      if (verdict !== "pending") {
        for (const { pattern, replace } of patchReplacements(p)) {
          if (!pattern || typeof replace !== "string") continue;
          if (!matchesPattern(asLf(text), pattern)) miss.push(snippet(pattern));
        }
      }
      info.push({ key, fp: path.relative(aiBase, fp), verdict, misses: miss });
    }
  }
  let status;
  if (pending > 0) status = "pending";
  else if (settled > 0) status = "applied";
  else if (unchangeable > 0) status = p.strictFiles ? "pattern_not_found" : "skipped";
  else status = p.optional ? "na" : "missing_file";
  rows.push({
    id: p.id, name: p.name, layer: p.layer, status,
    optional: !!p.optional, strictFiles: !!p.strictFiles, surfaces: p.surfaces || null,
    pending, settled, unchangeable, nofile,
  });
  details[p.id] = info;
}

const out = { aiBase, useBak: USE_BAK, rows, details };
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(out, null, 2), "utf8");

const summary = {};
for (const r of rows) summary[r.status] = (summary[r.status] || 0) + 1;
console.log(`aiBase = ${aiBase}   bak-overlay = ${USE_BAK}`);
console.log(`targetFiles keys = ${Object.keys(files).length}`);
console.log(`patch status: ${Object.entries(summary).map(([k, v]) => `${k}=${v}`).join("  ")}`);

const bad = rows.filter((r) => ["pattern_not_found", "unmatched", "missing_file", "apply-error"].includes(r.status));
console.log(`\n##### 需要迁移的补丁 (${bad.length}) #####`);
for (const r of bad) {
  console.log(`#${r.id} ${r.name}  [${r.status}]${r.strictFiles ? " strict" : ""}${r.optional ? " opt" : ""} surfaces=${JSON.stringify(r.surfaces)} pending=${r.pending} settled=${r.settled} unmatched=${r.unchangeable} nofile=${r.nofile}`);
  for (const k of details[r.id]) {
    if (k.verdict === "pending" || k.verdict === "applied") continue;
    console.log(`   key=${k.key}${k.files === undefined ? "" : " :: " + (k.files || []).join(", ")} [${k.verdict}]`);
    for (const m of (k.misses || []).slice(0, 10)) console.log(`      MISS ${m}`);
  }
}
if (SHOW_OK) {
  console.log(`\n##### 已就绪 #####`);
  for (const r of rows) if (r.status === "pending") console.log(`#${r.id} ${r.name} pending=${r.pending}`);
}
