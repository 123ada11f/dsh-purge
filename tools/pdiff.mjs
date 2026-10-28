// 对比两份 dump-patches.mjs 产物：id 集合差异 + 逐补丁 key 级差异概览。
// 用法: node tools/pdiff.mjs <mine.json> <theirs.json>
import fs from "node:fs";
const a = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const b = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
const byId = (arr) => {
  const m = new Map();
  for (const p of arr) m.set(String(p.id), p);
  return m;
};
const A = byId(a), B = byId(b);
console.log("count mine=" + a.length + " theirs=" + b.length);
console.log("only mine  : " + [...A.keys()].filter((k) => !B.has(k)).join(","));
console.log("only theirs: " + [...B.keys()].filter((k) => !A.has(k)).join(","));
const shared = [...A.keys()].filter((k) => B.has(k));
let same = 0;
const diff = [];
for (const id of shared) {
  if (JSON.stringify(A.get(id)) === JSON.stringify(B.get(id))) same++;
  else diff.push(id);
}
console.log("shared=" + shared.length + " identical=" + same + " differing=" + diff.length);
console.log("differing ids: " + diff.join(","));
console.log("");
for (const id of diff) {
  const x = A.get(id), y = B.get(id);
  const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
  const changed = [...keys].filter((k) => JSON.stringify(x[k]) !== JSON.stringify(y[k]));
  const nr = (o) => (Array.isArray(o.replacements) ? o.replacements.length : 0);
  console.log(`#${id} ${x.name || y.name}: [${changed.join(", ")}]  repl mine=${nr(x)} theirs=${nr(y)}  file mine=${JSON.stringify(x.file)} theirs=${JSON.stringify(y.file)}`);
}
