// 对指定补丁：打印 pattern/replace，并在 0.2.1 原文里定位"近似锚点"区域，同时给出 0.2.0(已打)
// 对应文件区域，便于人工比对结构变化。
// 用法: node tools/probe.mjs <pluginRoot> <aiBase021> <aiBase020> <dshHome> <ids 逗号分隔> <outFile>
import path from "node:path";
import fs from "node:fs";

const [pluginRoot, aiBase021, aiBase020, dshHome, idsArg, outFile] = process.argv.slice(2);
process.env.DSH_HOME = dshHome;
process.env.DSH_SURFACE = process.env.DSH_SURFACE || "web";
const core = await import(new URL("file:///" + path.join(pluginRoot, "lib", "core.js").replace(/\\/g, "/")).href);

const ids = idsArg.split(",").map(Number);
const files021 = core.targetFiles(aiBase021, dshHome);
const files020 = core.targetFiles(aiBase020, dshHome);
const keysOf = (p) => (Array.isArray(p.file) ? p.file : [p.file]);
const reps = (p) => (Array.isArray(p.replacements) ? p.replacements : (p.patterns ?? []).map((pat) => ({ pattern: pat, replace: p.replace })));
const patText = (pat) => (pat && pat.__re !== undefined ? `/${pat.__re}/${pat.flags}` : String(pat));

function probeOf(pattern) {
  if (!pattern) return "";
  const s = patText(pattern);
  const lines = s.split("\n").filter((l) => l.trim().length > 8);
  const longest = (lines.length ? lines : [s]).sort((a, b) => b.replace(/\s+/g, "").length - a.replace(/\s+/g, "").length)[0];
  return longest.replace(/^[ \t]+/, "");
}
function locate(text, probe) {
  for (const n of [60, 40, 30, 20, 12]) {
    const p = probe.slice(0, n);
    if (p.length < 8) break;
    const i = text.indexOf(p);
    if (i >= 0) return { at: i, used: n };
  }
  // 退化：只用第一段非空白
  const word = probe.split(/[\s(]/)[0];
  if (word && word.length >= 6) {
    const i = text.indexOf(word);
    if (i >= 0) return { at: i, used: 0, word };
  }
  return null;
}

const out = [];
for (const id of ids) {
  const p = core.ALL_PATCHES.find((x) => x.id === id);
  if (!p) { out.push(`### #${id} NOT FOUND`); continue; }
  out.push(`\n\n==============================================================`);
  out.push(`### PATCH #${p.id}  ${p.name}   file=${JSON.stringify(p.file)} strict=${!!p.strictFiles} opt=${!!p.optional}`);
  out.push(p.desc ? `desc: ${p.desc}` : "");
  let k = 0;
  for (const { pattern, replace } of reps(p)) {
    k += 1;
    out.push(`--- pattern[${k}] ---\n${patText(pattern)}`);
    out.push(`--- replace[${k}] ---\n${replace}`);
  }
  out.push(`--- markers --- ${JSON.stringify(p.markers || p.marker || null)}  markersAny=${!!p.markersAny} skipIfMarked=${!!p.skipIfMarked}`);
  for (const key of keysOf(p)) {
    const raw021 = files021[key];
    const raw020 = files020[key];
    const arr021 = (Array.isArray(raw021) ? raw021 : [raw021]).filter(Boolean).filter((f) => fs.existsSync(f));
    const arr020 = (Array.isArray(raw020) ? raw020 : [raw020]).filter(Boolean).filter((f) => fs.existsSync(f));
    out.push(`\n@@ key=${key}\n   0.2.1: ${arr021.join(" | ") || "(none)"}\n   0.2.0: ${arr020.join(" | ") || "(none)"}`);
    for (const fp of arr021) {
      const text = fs.readFileSync(fp, "utf8").replace(/\r\n/g, "\n");
      for (const { pattern } of reps(p)) {
        const probe = probeOf(pattern);
        const hit = locate(text, probe);
        if (!hit) {
          out.push(`   [${key}] PROBE-NOT-FOUND: ${probe.slice(0, 70)}`);
          continue;
        }
        const a = Math.max(0, hit.at - 400);
        const b = Math.min(text.length, hit.at + 1400);
        const lineNo = text.slice(0, hit.at).split("\n").length;
        out.push(`   [${key}] probe matched at line ${lineNo} (used ${hit.used} chars) ----------`);
        out.push(text.slice(a, b));
        out.push("   ---------- end region ----------");
      }
    }
    for (const fp of arr020) {
      const text = fs.readFileSync(fp, "utf8").replace(/\r\n/g, "\n");
      out.push(`   [0.2.0 ${key}] PATTERN-STILL-PRESENT? ${fs.readFileSync(fp, "utf8").includes(probeOf(reps(p)[0].pattern).slice(0, 40))}`);
    }
  }
}
fs.writeFileSync(outFile, out.join("\n"), "utf8");
console.log(`wrote ${outFile} (${out.join("\n").length} chars)`);
