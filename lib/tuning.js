// Plugin-owned tuning state. Deliberately NOT stored in the profile cordis config:
// switching a behaviour must never require editing a DSH file or a restart of the
// profile's YAML, and must survive `dsh plugin add`.
import fs from "node:fs";
import path from "node:path";
import { findDshHome } from "./core.js";
import { logAudit } from "./audit.js";

export const TUNING_FILE = "tuning.json";

/** 默认值即"全开"：破甲是这个插件的唯一目的，默认就不该留门。 */
export const TUNING_DEFAULTS = Object.freeze({
  boost: true, // 尾部强化段
  injectPosition: "head", // head | tail | both —— 注入在系统提示词里的位置
  askNoBlock: true, // 兼容字段
  rewind: true, // 输入框右侧的「回退」按钮（原版功能，可按需隐藏）
  refusalRetry: true, // 模型推脱时自动加一句加固重试一次（llm/stream 钩子）；提示词层失守时的事后兜底
  userTail: true, // 最后一条 user 消息尾部追加短执行指令（recency 通道，与 system 注入正交）
  slotGate: false, // 按任务类裁剪注入槽（默认关：静态收益已测，行为等价性尚未在本机验证；置 true 开启）
});

function tuningPath(dshHome) {
  const home = dshHome || findDshHome();
  if (!home) return "";
  return path.join(home, "dsh-purge", TUNING_FILE);
}

/**
 * 进程级临时覆盖：DSH_PURGE_TUNING='{"slotGate":true}'。
 * 用途：A/B 两臂可在同一台机器上并发跑，互不改写全局 tuning.json。
 */
function envOverrides() {
  const raw = process.env.DSH_PURGE_TUNING;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out = {};
    for (const key of Object.keys(TUNING_DEFAULTS)) {
      if (Object.prototype.hasOwnProperty.call(parsed, key)) out[key] = parsed[key];
    }
    return out;
  } catch {
    return {};
  }
}

export function readTuning(dshHome) {
  const file = tuningPath(dshHome);
  if (!file) return { ...TUNING_DEFAULTS, ...envOverrides() };
  let saved = {};
  try {
    saved = JSON.parse(fs.readFileSync(file, "utf8")) || {};
  } catch {
    saved = {};
  }
  const merged = { ...TUNING_DEFAULTS, ...saved, ...envOverrides() };
  if (!["head", "tail", "both"].includes(merged.injectPosition)) {
    merged.injectPosition = TUNING_DEFAULTS.injectPosition;
  }
  return merged;
}

export function writeTuning(patch = {}, dshHome) {
  const file = tuningPath(dshHome);
  if (!file) throw new Error("未定位 DSH 数据目录，无法保存 tuning");
  const before = readTuning(dshHome);
  const next = { ...before, ...patch };
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify(next, null, 2), { mode: 0o600 });
  const effective = readTuning(dshHome);
  // Record effective values, not invalid input that readTuning normalizes away.
  // Only known, non-secret settings belong in the public audit schema.
  for (const key of Object.keys(TUNING_DEFAULTS)) {
    if (!Object.prototype.hasOwnProperty.call(patch, key) || before[key] === effective[key]) continue;
    const auditValue = (value) => key === "injectPosition"
      ? (["head", "tail", "both"].includes(value) ? value : "invalid")
      : (typeof value === "boolean" ? value : "invalid");
    logAudit("tuning_setting", { key, from: auditValue(before[key]), to: auditValue(effective[key]) }, path.dirname(path.dirname(file)));
  }
  return effective;
}
