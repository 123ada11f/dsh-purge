#!/usr/bin/env node
// PROBE_CMD 适配器（真实系统通道）：注入由 probe profile 里的 dsh-purge 插件完成，
// 探针本身作为普通用户消息送入 —— 与线上一致。两臂只差 tuning.slotGate。
//
// 用法：echo "探针" | PROBE_ARM=full|gated node scripts/probe-cmd2.mjs
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// 臂切换走进程环境变量（lib/tuning.js 的 DSH_PURGE_TUNING），不写全局 tuning.json，
// 这样 full/gated 两臂可以在同一台机器上并发跑而不互相踩。
const arm = (process.env.PROBE_ARM || "full").trim();
const profile = process.env.PROBE_PROFILE || "probe";
const timeoutMs = Number(process.env.PROBE_TIMEOUT_MS || 180000);

const prompt = (() => {
  try { return readFileSync(0, "utf8").trim(); } catch { return ""; }
})();
if (!prompt) { process.stderr.write("probe-cmd2: 空探针\n"); process.exit(2); }

const childEnv = { ...process.env, DSH_PURGE_TUNING: JSON.stringify({ slotGate: arm === "gated" }) };

const binJs = process.env.PROBE_DSH_BIN || "";
// 可选：PROBE_MODEL / PROBE_REASONING 通过 --patch 覆盖默认模型，不必改 profile。
const wantModel = (process.env.PROBE_MODEL || "").trim();
const wantEffort = (process.env.PROBE_REASONING || "").trim();
let overlayArgs = [];
if (wantModel) {
  const ovPath = path.join(os.tmpdir(), `probe-model-${process.pid}.yml`);
  const lines = [
    "- id: agent-default-model",
    "  config:",
    "    provider: magpie",
    `    model: ${JSON.stringify(wantModel)}`,
  ];
  if (wantEffort) lines.push(`    reasoningEffort: ${JSON.stringify(wantEffort)}`);
  writeFileSync(ovPath, lines.join("\n") + "\n", "utf8");
  overlayArgs = ["--patch", ovPath];
  process.on("exit", () => { try { unlinkSync(ovPath); } catch { /* ignore */ } });
}
const baseArgs = ["--profile", profile, ...overlayArgs, "--json", "-"];
const r = spawnSync(binJs ? process.execPath : "dsh",
  binJs ? [binJs, ...baseArgs] : baseArgs, {
  input: prompt,
  encoding: "utf8",
  timeout: timeoutMs,
  shell: !binJs,
  env: childEnv,
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
