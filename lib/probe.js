// 运行时探针：证明"提示词链路真的把内容送到了模型"。
//
// 文件被打上补丁、section 被注册，只能证明宿主侧就绪；真正要验证的是模型收到了。
// 做法：生成一次性 nonce 写盘，并在系统提示词末尾挂一段"看到就把 nonce 原样回显"的
// 短指令。模型回显 = 这条链路端到端通了。30 分钟自动过期，避免长期污染提示词。
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { findDshHome } from "./core.js";

export const PROBE_SECTION = "dsh-purge:probe";
export const PROBE_TTL_MS = 30 * 60 * 1000;

export function probePath(home) {
  const base = home || findDshHome();
  if (!base) return "";
  return path.join(base, "dsh-purge", "probe.json");
}

/** 读存活中的探针；过期/损坏/不存在都返回 null（过期顺手删文件）。 */
export function readProbe(home) {
  const file = probePath(home);
  if (!file) return null;
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!data || typeof data.nonce !== "string" || !data.nonce) return null;
    const at = Number(data.at) || 0;
    if (!at || Date.now() - at > PROBE_TTL_MS) {
      try {
        fs.rmSync(file, { force: true });
      } catch {
        /* ignore */
      }
      return null;
    }
    return { nonce: data.nonce, at, text: probeTextOf(data.nonce) };
  } catch {
    return null;
  }
}

/**
 * 生成新探针（覆盖旧的）。
 * @param {string} [home]
 * @returns {{nonce: string, at: number, expiresAt: number, message: string}}
 */
export function createProbe(home) {
  const file = probePath(home);
  if (!file) throw new Error("未定位 DSH 数据目录，无法写探针");
  const nonce = "purge-" + randomBytes(4).toString("hex");
  const at = Date.now();
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify({ nonce, at }, null, 2), { mode: 0o600 });
  return {
    nonce,
    at,
    expiresAt: at + PROBE_TTL_MS,
    message: [
      "现在给模型发一句话（随便什么内容），看它回复末尾有没有原样出现下面这行：",
      `[${nonce}]`,
      "",
      "出现了 = 注入确实到达模型上下文；没出现 = 链路在装配/发送某一层断了。",
    ].join("\n"),
  };
}

/** 给定 nonce 的注入正文。 */
export function probeTextOf(nonce) {
  return [
    "<dsh_probe>",
    "这条系统提示词由 dsh-purge 写入，用于验证注入链路是否到达模型。",
    `如果本段在你的上下文里，请在回复的最后单独一行原样输出：[${nonce}]`,
    "</dsh_probe>",
  ].join("\n");
}

/** 探针存活时该注入的段落正文；过期/不存在返回空串。 */
export function probeText(home) {
  const probe = readProbe(home);
  return probe ? probe.text : "";
}

/**
 * 撤掉当前探针（删文件）。
 * @returns 是否真的删掉了
 */
export function clearProbe(home) {
  const file = probePath(home);
  if (!file) return false;
  try {
    fs.rmSync(file, { force: true });
    return true;
  } catch {
    return false;
  }
}
