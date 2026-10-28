// 导出全部补丁定义为可读 JSON（RegExp → {__re, flags}），供逐条核对锚点。
import path from "node:path";
import fs from "node:fs";
const pluginRoot = process.argv[2];
const out = process.argv[3];
const url = new URL("file:///" + path.join(pluginRoot, "lib", "core.js").replace(/\\/g, "/"));
const core = await import(url.href);
const norm = (v) => {
  if (v instanceof RegExp) return { __re: v.source, flags: v.flags };
  return v;
};
const rows = core.ALL_PATCHES.map((p) => {
  const o = {};
  for (const [k, v] of Object.entries(p)) {
    if (Array.isArray(v)) o[k] = v.map(norm);
    else o[k] = norm(v);
  }
  return o;
});
fs.writeFileSync(out, JSON.stringify(rows, null, 2), "utf8");
console.log(`wrote ${out}  patches=${rows.length}`);
console.log("ids: " + rows.map((r) => r.id).join(","));
