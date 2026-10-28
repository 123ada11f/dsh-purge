// 对比两次 diag 结果：找出"0.2.0 能打、0.2.1 打不动"的补丁。
import fs from "node:fs";
const a = JSON.parse(fs.readFileSync(process.argv[2], "utf8")); // 0.2.0 (已打过)
const b = JSON.parse(fs.readFileSync(process.argv[3], "utf8")); // 0.2.1 (出厂)
const A = new Map(a.rows.map((r) => [r.id, r]));
const B = new Map(b.rows.map((r) => [r.id, r]));
const ids = [...new Set([...A.keys(), ...B.keys()])].sort((x, y) => x - y);
// 在 0.2.0 上判定为"成功"的状态
const OK020 = new Set(["applied", "already", "na", "missing_file", "skipped"]);
const GONE = [];
const UNCHANGED = [];
for (const id of ids) {
  const ra = A.get(id), rb = B.get(id);
  const sa = ra ? ra.status : "-";
  const sb = rb ? rb.status : "-";
  const line = `#${id}\t${(rb?.name || ra?.name || "?").padEnd(38)}\t0.2.0=${sa.padEnd(18)}\t0.2.1=${sb}`;
  // 0.2.1 上"能应用"= pending；标记型补丁在出厂树上也可能是 applied 语义
  if (sb === "pending") UNCHANGED.push(line);
  else GONE.push({ id, name: rb?.name || ra?.name, sa, sb, line });
}
console.log(`===== 0.2.1 上不能直接应用的补丁 (${GONE.length}) =====`);
for (const g of GONE) console.log(g.line);
console.log(`\n===== 0.2.1 上可直接应用 (${UNCHANGED.length}) =====`);
for (const l of UNCHANGED) console.log(l);
