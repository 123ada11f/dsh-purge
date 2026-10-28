// 用插件自己的 patchStatus() 输出状态统计（不做任何复刻判定）。
// 用法: node tools/status-raw.mjs <pluginRoot> <aiBase> <dshHome>
import path from "node:path";
const [pluginRoot, aiBase, dshHome] = process.argv.slice(2);
const core = await import(new URL("file:///" + path.join(pluginRoot, "lib", "core.js").replace(/\\/g, "/")).href);
const status = await core.patchStatus(aiBase, core.ALL_PATCHES, { dshHome });
const counts = {};
for (const v of Object.values(status)) counts[v] = (counts[v] || 0) + 1;
const entries = Object.entries(status);
const softKeywords = /applied|already|na|off|settled|absent|ok|soft/i;
const odd = entries.filter(([, v]) => !softKeywords.test(String(v)));
console.log("patches: " + entries.length);
console.log("counts : " + JSON.stringify(counts));
console.log("non-soft: " + (odd.length ? odd.map(([k, v]) => `#${k}:${v}`).join(" ") : "(none)"));
