#!/usr/bin/env node
// PROBE_CMD 适配器：把「当前臂的注入文本 + 探针问题」送进本地 dsh headless 模型，
// 只回吐最终答复文本（供 scripts/probe-hardening.mjs 打分）。
//
// 为什么不用插件注入：headless profile 没装 dsh-purge，插件钩子不生效；
// 两臂只在注入文本上不同（full=出厂槽全文 / gated=按该探针问题裁剪后的槽），
// 其余一切相同，所以两臂差异只归因于分节裁剪本身。
//
// 用法：echo "探针问题" | PROBE_ARM=gated node scripts/probe-cmd.mjs
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gateSlot } from "../lib/slot-gate.js";
import { BOOST_TEXT } from "../lib/boost.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const mdPath = path.join(here, "..", "lib", "default-prompt-inject.md");
const arm = (process.env.PROBE_ARM || "full").trim();
const timeoutMs = Number(process.env.PROBE_TIMEOUT_MS || 240000);

const readStdin = () => {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
};

const prompt = readStdin().trim();
if (!prompt) {
  process.stderr.write("probe-cmd: 空探针\n");
  process.exit(2);
}

let slot = "";
try {
  slot = readFileSync(mdPath, "utf8");
} catch {
  slot = "";
}

const inject = arm === "gated" && slot ? gateSlot(slot, prompt).text : slot;
const task = [
  "<<<SYSTEM-INJECT>>>",
  inject.trim(),
  "<<<END-SYSTEM-INJECT>>>",
  BOOST_TEXT.trim(),
  "",
  "用户消息（照上面注入规则回答）：",
  prompt,
].join("\n");

const r = spawnSync("dsh", ["--profile", "headless", "--json", "-"], {
  input: task,
  encoding: "utf8",
  timeout: timeoutMs,
  shell: true,
  maxBuffer: 32 * 1024 * 1024,
});

if (r.error) {
  process.stdout.write(`__PROBE_ERROR__ ${r.error.message}\n`);
  process.exit(0);
}

const lines = String(r.stdout || "").split(/\r?\n/).filter(Boolean);
let final = "";
for (const line of lines) {
  try {
    const ev = JSON.parse(line);
    if (ev && ev.type === "final" && typeof ev.text === "string") final = ev.text;
  } catch { /* 非 JSON 行忽略 */ }
}
if (!final) {
  process.stdout.write(`__PROBE_ERROR__ no final event (exit=${r.status})\n`);
  process.exit(0);
}
process.stdout.write(final);
