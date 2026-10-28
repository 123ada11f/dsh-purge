// 审计日志：插件自己做的每一次"改变宿主/预设/开关"的动作都留一条记录。
//
// 边界说明：宿主补丁是**写进 DSH 源码**的，插件运行时看不到"某次工具调用被哪条补丁放行"。
// 这里记录的是可观测的部分——谁在什么时候改了什么、结果如何——排查时足够回答
// "这次应用到底跑没跑""是不是有人把开关关了""上次重锚改的是哪一条"。
//
// 设计约束：
// - 写失败绝不打断主流程（审计不能变成可用性风险）。
// - 只追加，1MB 轮转，保留 2 份历史。
// - 字段里不要放密钥；`data` 原样落盘。
import fs from "node:fs";
import path from "node:path";
import { findDshHome } from "./core.js";

export const AUDIT_FILE = "audit.jsonl";
export const AUDIT_MAX_BYTES = 1024 * 1024;
export const AUDIT_KEEP = 2;

/** 审计文件路径；定位不到 DSH 数据目录时返回空串（调用方据此跳过）。 */
export function auditPath(home) {
  const base = home || findDshHome();
  if (!base) return "";
  return path.join(base, "dsh-purge", AUDIT_FILE);
}

function rotate(file) {
  try {
    const st = fs.statSync(file);
    if (st.size < AUDIT_MAX_BYTES) return;
  } catch {
    return;
  }
  for (let i = AUDIT_KEEP; i >= 1; i -= 1) {
    const from = i === 1 ? file : `${file}.${i - 1}`;
    const to = `${file}.${i}`;
    try {
      if (fs.existsSync(from)) fs.renameSync(from, to);
    } catch {
      /* 轮转失败不影响本次追加 */
    }
  }
}

/**
 * 追加一条审计记录。
 * @param {string} event 事件名，如 apply/revert/uninstall/preset/reanchor/probe/shims
 * @param {object} [data] 附加字段（会原样入库）
 * @param {string} [home] 覆盖 DSH 数据目录（测试用）
 * @returns {boolean} 是否写入成功
 */
export function logAudit(event, data = {}, home) {
  try {
    const file = auditPath(home);
    if (!file) return false;
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    rotate(file);
    const row = { at: new Date().toISOString(), event, pid: process.pid, ...data };
    fs.appendFileSync(file, JSON.stringify(row) + "\n", { mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}

/**
 * 读最近若干条（新的在前）。坏行（半截写入）直接跳过。
 * @param {{limit?: number, home?: string}} [options]
 * @returns {Array<object>}
 */
export function readAudit(options = {}) {
  const { limit = 50, home } = options;
  const file = auditPath(home);
  if (!file) return [];
  let text = "";
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const rows = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      /* 半行（写入中断）直接跳过 */
    }
  }
  const n = Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 500) : 50;
  return rows.slice(-n).reverse();
}
