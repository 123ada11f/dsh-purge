// 对比两个 dsh-purge 补丁表的差异（本 fork vs 社区 fork）。
// 用法: node tools/patchset-diff.mjs <rootA> <rootB> [idsDump]
import path from "node:path";
import fs from "node:fs";

async function loadAll(root) {
  const url = new URL("file:///" + path.join(root, "lib", "core.js").replace(/\\/g, "/"));
  const core = await import(url.href);
  const list = core.ALL_PATCHES;
  const map = new Map();
  for (const p of list) {
    const reps = (p.replacements || []).map((r) => ({
      pattern: r.pattern instanceof RegExp ? String(r.pattern) : String(r.pattern),
      replace: r.replace instanceof RegExp ? String(r.replace) : String(r.replace),
      isRe: r.pattern instanceof RegExp,
    }));
    const files = p.file === undefined ? null : Array.isArray(p.file) ? p.file : [p.file];
    map.set(p.id, {
      id: p.id,
      name: p.name,
      file: files,
      reps,
      optional: !!p.optional,
      strictFiles: !!p.strictFiles,
      softSettle: !!p.softSettle,
      settleWhenAbsent: !!p.settleWhenAbsent,
      why: p.why || p.reason || p.note || "",
    });
  }
  return { core, map };
}

const [rootA, rootB] = process.argv.slice(2);
const A = await loadAll(rootA);
const B = await loadAll(rootB);
const onlyA = [...A.map.keys()].filter((id) => !B.map.has(id));
const onlyB = [...B.map.keys()].filter((id) => !A.map.has(id));
const common = [...A.map.keys()].filter((id) => B.map.has(id));

const lines = [];
lines.push(`A = ${rootA}  (${A.map.size} patches)`);
lines.push(`B = ${rootB}  (${B.map.size} patches)`);
lines.push(`only in A: ${onlyA.map((i) => "#" + i).join(" ") || "(none)"}`);
lines.push(`only in B: ${onlyB.map((i) => "#" + i).join(" ") || "(none)"}`);
lines.push("");

const differing = [];
for (const id of common) {
  const a = A.map.get(id);
  const b = B.map.get(id);
  const diffs = [];
  if (a.name !== b.name) diffs.push(`name: ${a.name} vs ${b.name}`);
  if (JSON.stringify(a.file) !== JSON.stringify(b.file)) diffs.push(`file: ${JSON.stringify(a.file)} vs ${JSON.stringify(b.file)}`);
  if (a.reps.length !== b.reps.length) diffs.push(`replacements count: ${a.reps.length} vs ${b.reps.length}`);
  const nMin = Math.min(a.reps.length, b.reps.length);
  for (let i = 0; i < nMin; i += 1) {
    if (a.reps[i].pattern !== b.reps[i].pattern) diffs.push(`rep[${i}].pattern differs`);
    else if (a.reps[i].replace !== b.reps[i].replace) diffs.push(`rep[${i}].replace differs`);
  }
  if (a.reps.length !== b.reps.length) {
    const extraA = a.reps.slice(nMin);
    const extraB = b.reps.slice(nMin);
    for (const [i, r] of extraA.entries()) diffs.push(`A extra rep[${nMin + i}]: ${JSON.stringify(r.pattern).slice(0, 160)}`);
    for (const [i, r] of extraB.entries()) diffs.push(`B extra rep[${nMin + i}]: ${JSON.stringify(r.pattern).slice(0, 160)}`);
  }
  if (a.softSettle !== b.softSettle) diffs.push(`softSettle: ${a.softSettle} vs ${b.softSettle}`);
  if (a.settleWhenAbsent !== b.settleWhenAbsent) diffs.push(`settleWhenAbsent: ${a.settleWhenAbsent} vs ${b.settleWhenAbsent}`);
  if (a.strictFiles !== b.strictFiles) diffs.push(`strictFiles: ${a.strictFiles} vs ${b.strictFiles}`);
  if (a.optional !== b.optional) diffs.push(`optional: ${a.optional} vs ${b.optional}`);
  if (diffs.length) {
    differing.push(id);
    lines.push(`### #${id} ${a.name} / ${b.name}`);
    for (const d of diffs) lines.push(`  - ${d}`);
    lines.push("");
  }
}
lines.unshift(`differing ids (${differing.length}): ${differing.map((i) => "#" + i).join(" ")}`, "");
const out = lines.join("\n");
fs.writeFileSync(path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, "")), "..", "work", "patchset-diff.txt"), out, "utf8");
console.log(out.slice(0, 6000));
