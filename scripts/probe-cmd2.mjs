#!/usr/bin/env node
// PROBE_CMD 适配器（真实系统通道）：注入由 probe profile 里的 dsh-purge 插件完成，
// 探针本身作为普通用户消息送入 —— 与线上一致。两臂只差 tuning.slotGate。
//
// 用法：echo "探针" | PROBE_ARM=full|gated node scripts/probe-cmd2.mjs
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const arm = (process.env.PROBE_ARM || "full").trim();
const profile = process.env.PROBE_PROFILE || "probe";
const timeoutMs = Number(process.env.PROBE_TIMEOUT_MS || 180000);

const dshHome = process.env.DSH_HOME || path.join(os.homedir(), ".dsh");
const tuningDir = path.join(dshHome, "dsh-purge");
const tuningFile = path.join(tuningDir, "tuning.json");

function setSlotGate(on) {
  let cur = {};
  try { cur = JSON.parse(readFileSync(tuningFile, "utf8")) || {}; } catch { cur = {}; }
  cur.slotGate = on;
  try {
    mkdirSync(tuningDir, { recursive: true });
    writeFileSync(tuningFile, JSON.stringify(cur, null, 2), "utf8");
  } catch { /* 写不进去就按默认走 */ }
}
setSlotGate(arm === "gated");

const prompt = (() => {
  try { return readFileSync(0, "utf8").trim(); } catch { return ""; }
})();
if (!prompt) { process.stderr.write("probe-cmd2: 空探针\n"); process.exit(2); }

const binJs = process.env.PROBE_DSH_BIN || "";
const r = spawnSync(binJs ? process.execPath : "dsh",
  binJs ? [binJs, "--profile", profile, "--json", "-"] : ["--profile", profile, "--json", "-"], {
  input: prompt,
  encoding: "utf8",
  timeout: timeoutMs,
  shell: !binJs,
  maxBuffer: 32 * 1024 * 1024,
});

if (r.error) { process.stdout.write(`__PROBE_ERROR__ ${r.error.message}\n`); process.exit(0); }
let final = "";
for (const line of String(r.stdout || "").split(/\r?\n/)) {
  if (!line.trim()) continue;
  try {
    const ev = JSON.parse(line);
    if (ev && ev.type === "final" && typeof ev.text === "string") final = ev.text;
  } catch { /* ignore */ }
}
process.stdout.write(final || `__PROBE_ERROR__ no final (exit=${r.status})\n`);
