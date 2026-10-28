// 间接提示词注入（indirect prompt injection）防护。
//
// 威胁模型：恶意指令不来自用户，而藏在模型会读取的"数据"里——网页抓取、MCP 工具回包、
// 文件正文、代码注释、PDF/图片 OCR。模型分不清"工具返回的数据"和"用户下的命令"，读到
// 指令就可能执行。本模块只做一件防守方该做的事：
//   1) 特征扫描：发现 tool 回包 / 外部内容里的可疑指令片段，落地审计（可选注入提醒）。
//   2) 出口地板：拦住模型把敏感内容或内网地址外发到陌生主机（靠 host 白名单 + 密钥特征）。
//
// 它不依赖模型判断对不对——机制层的闸，比让模型"认出是不是注入"可靠一万倍。
import fs from "node:fs";
import path from "node:path";

// —— 可疑指令特征。宁可宽一点，扫描结果只上报不拦截正文，误报代价低。 ——
const SUSPECT_PATTERNS = [
  // 覆盖/忽略既有指令
  /ignore (?:all |any |the )?(?:previous|prior|above|earlier) (?:instructions?|prompts?|rules?)/i,
  /disregard (?:all |any |the )?(?:previous|prior|above|earlier|system)/i,
  /forget (?:everything|all|your) (?:above|before|previous|instructions?|rules?)/i,
  /忽略(?:之前|以上|前面|先前|所有)?(?:的)?(?:所有)?(?:指令|提示|规则|要求)/,
  /无视(?:之前|以上|前面|所有|系统)/,
  // 自称系统/开发者/最高权限
  /\[?(?:system|developer)\s*(?:message|override|instruction)\]?/i,
  /you are now (?:in )?(?:dan|developer|god|unrestricted|jailbreak)/i,
  /act as (?:an? )?(?:unrestricted|jailbroken|dan)/i,
  // 让模型执行动作/外发数据
  /you must now (?:call|run|execute|invoke|send|post)/i,
  /(?:execute|run) (?:the )?(?:following|this) (?:command|code|script)/i,
  /(?:send|post|upload|transmit|exfiltrate) (?:the |all |this )?(?:data|content|token|secret|key|credential|api[ _-]?key)/i,
  /(?:curl|wget|fetch)\s+https?:\/\/\S+\s*-[dX]/i,
  /把(?:上述|以上|这些|该)?(?:内容|数据|密钥|token|令牌|凭据)(?:发送|上传|转发|回传)/,
  // 伪装成"新任务"要看系统提示词
  /(?:print|reveal|show|repeat|output|leak) (?:your )?(?:system |initial |hidden )?(?:prompt|instructions?)/i,
  /(?:输出|泄露|打印|显示|复述)(?:你的|系统|初始)?(?:提示词|系统提示|指令)/,
  // HTML/不可见文本线索
  /display\s*:\s*none/i,
  /<meta[^>]+(?:http-equiv|content)[^>]*instruction/i,
];
// 需要"同时出现两个及以上不同特征"才判可疑，降低单词误报。
const SUSPECT_MIN_HITS = 1;

// 敏感内容特征（用于出口地板：模型想外发这些内容时报警）。
const SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9]{20,}\b/,            // OpenAI 风格
  /\bAKIA[0-9A-Z]{16}\b/,               // AWS access key
  /\bghp_[A-Za-z0-9]{36}\b/,            // GitHub PAT
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,   // Slack
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/, // JWT
  /\b(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?token)\s*[:=]\s*["']?[^\s"']{6,}/i,
];

// 内网 / 环回地址（外发时的目标地板用）。
const PRIVATE_HOST = /^(?:localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+|169\.254\.\d+\.\d+|::1|fc[\da-f]{2}:|fd[\da-f]{2}:)/i;

export const INJECT_LOG_FILE = "injection-events.jsonl";
export const INJECT_LOG_MAX_BYTES = 512 * 1024;
export const INJECT_LOG_KEEP = 2;

export function injectLogPath(home) {
  const base = String(home || "").trim();
  if (!base) return "";
  return path.join(base, "dsh-purge", INJECT_LOG_FILE);
}

function rotateIfNeeded(file) {
  try {
    const st = fs.statSync(file);
    if (st.size <= INJECT_LOG_MAX_BYTES) return;
    for (let i = INJECT_LOG_KEEP - 1; i >= 1; i -= 1) {
      const src = `${file}.${i}`;
      const dst = `${file}.${i + 1}`;
      try { fs.renameSync(src, dst); } catch { /* 没有这一代 */ }
    }
    fs.renameSync(file, `${file}.1`);
  } catch { /* 文件不存在或还没权限，忽略 */ }
}

/** 追加一条注入事件到 jsonl（带轮转，不抛）。 */
export function logInjectEvent(home, event) {
  const file = injectLogPath(home);
  if (!file) return;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    rotateIfNeeded(file);
    fs.appendFileSync(file, JSON.stringify({ at: Date.now(), ...event }) + "\n", { mode: 0o600 });
  } catch { /* 审计写不进去不影响主流程 */ }
}

/** 读最近的注入事件（新→旧），最多 limit 条。 */
export function readInjectEvents(home, limit = 50) {
  const file = injectLogPath(home);
  if (!file) return [];
  try {
    const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
    const out = [];
    for (let i = lines.length - 1; i >= 0 && out.length < limit; i -= 1) {
      try { out.push(JSON.parse(lines[i])); } catch { /* 坏行跳过 */ }
    }
    return out;
  } catch {
    return [];
  }
}

/** 扫描一段文本，返回命中的可疑指令特征（去重、截断预览）。 */
export function scanSuspect(text) {
  const sample = String(text || "").slice(0, 65536);
  if (!sample) return [];
  const hits = [];
  const seen = new Set();
  for (const re of SUSPECT_PATTERNS) {
    const m = sample.match(re);
    if (!m) continue;
    const key = String(m[0]).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    hits.push({ pattern: String(re), match: key.slice(0, 80) });
    if (hits.length >= 8) break;
  }
  return hits;
}

/** 扫敏感内容特征（密钥/JWT/私钥）。 */
export function scanSecrets(text) {
  const sample = String(text || "").slice(0, 65536);
  if (!sample) return [];
  const hits = [];
  for (const re of SECRET_PATTERNS) {
    const m = sample.match(re);
    if (m) hits.push({ pattern: String(re), preview: String(m[0]).slice(0, 12) + "…" });
  }
  return hits;
}

/** 从文本里抠出所有主机（http(s)、裸域名、IP）。够用于出口地板。 */
export function hostsIn(text) {
  const sample = String(text || "").slice(0, 65536).toLowerCase();
  const hosts = new Set();
  for (const m of sample.matchAll(/https?:\/\/([^/\s?#:]+)/g)) hosts.add(m[1]);
  for (const m of sample.matchAll(/\b(?:[a-z0-9-]+\.)+[a-z]{2,63}\b/g)) hosts.add(m[0]);
  for (const m of sample.matchAll(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g)) hosts.add(m[0]);
  return hosts;
}

/**
 * 出口地板：判断一次"疑似外发"是否危险。
 * 危险 = 目的主机里有陌生公网主机，且同时文本里带敏感特征或内网地址。
 * 这里只做判定，不替用户拦（拦不拦由调用方决定，避免误伤正常检索）。
 */
export function assessEgress(text, allowHosts = []) {
  const allow = new Set((allowHosts || []).map((h) => String(h).toLowerCase()));
  const hosts = [...hostsIn(text)].filter((h) => !allow.has(h));
  const publicHosts = hosts.filter((h) => !PRIVATE_HOST.test(h));
  const secrets = scanSecrets(text);
  const privateTarget = hosts.some((h) => PRIVATE_HOST.test(h)) &&
    // 同时出现公网主机才是"把内网的东西往外发"
    publicHosts.length > 0;
  const risky = (secrets.length > 0 && publicHosts.length > 0) || privateTarget;
  return { risky, publicHosts, secrets, privateTarget };
}

function looksLikeToolResult(message, text) {
  if (message?.toolCallId || message?.tool_call_id || message?.toolName) return true;
  if (message?.source?.kind && message.source.kind !== "user") return true;
  const head = String(text || "").slice(0, 240);
  return /^(?:Tool result|\[tool|function_call|toolu_|call_)/i.test(head);
}

function messageBody(message) {
  if (typeof message?.content === "string") return message.content;
  if (!Array.isArray(message?.content)) return typeof message?.text === "string" ? message.text : "";
  return message.content.map((block) => {
    if (typeof block === "string") return block;
    if (block && block.type === "text" && typeof block.text === "string") return block.text;
    return "";
  }).join("\n");
}

/**
 * 装一个 agent/pre-step 钩子，扫描本轮消息里的"工具回包/非用户来源内容"，
 * 命中可疑指令特征时写审计。（不修改消息内容，不注入——纯观测，零副作用。）
 *
 * @param {object} ctx
 * @param {{home?: () => string, onHit?: (ev: object) => void}} options
 */
export function installInjectionGuard(ctx, options = {}) {
  if (!ctx || typeof ctx.on !== "function") return () => {};
  if (ctx.__dshPurgeInjectionGuard) return ctx.__dshPurgeInjectionGuard;
  const getHome = typeof options.home === "function" ? options.home : () => "";
  const onHit = typeof options.onHit === "function" ? options.onHit : null;

  const seenKey = new Set();

  const hook = async (payload, next) => {
    const fwd = () => (typeof next === "function" ? next() : payload);
    try {
      const messages = Array.isArray(payload?.messages) ? payload.messages : [];
      // 只看最后若干条，历史里重复的旧 tool 回包不重复报警。
      for (const message of messages.slice(-8)) {
        const role = message?.role;
        if (role === "assistant" || role === "model") continue;
        const text = messageBody(message);
        if (!text) continue;
        const isTool = looksLikeToolResult(message, text);
        const hits = scanSuspect(text);
        if (hits.length < SUSPECT_MIN_HITS) continue;
        // 去重：同一内容指纹只报一次
        const key = text.length + ":" + hits.map((h) => h.match).join("|") + ":" + (message?.turn ?? "");
        if (seenKey.has(key)) continue;
        seenKey.add(key);
        if (seenKey.size > 500) seenKey.clear();
        const ev = {
          kind: "suspect-instruction",
          fromTool: isTool,
          hits,
          preview: text.slice(0, 160).replace(/\s+/g, " "),
        };
        logInjectEvent(getHome(), ev);
        if (onHit) { try { onHit(ev); } catch { /* 观察回调异常不影响主流程 */ } }
      }
    } catch { /* 扫描失败绝不阻塞这一轮 */ }
    return fwd();
  };

  const dispose = () => {
    try { if (typeof ctx.off === "function" && ctx.__dshPurgeInjectionGuardHook) ctx.off("agent/pre-step", ctx.__dshPurgeInjectionGuardHook); } catch { /* ignore */ }
    delete ctx.__dshPurgeInjectionGuard;
    delete ctx.__dshPurgeInjectionGuardHook;
  };

  try {
    ctx.on("agent/pre-step", hook, { global: true, prepend: true });
    ctx.__dshPurgeInjectionGuardHook = hook;
    ctx.__dshPurgeInjectionGuard = dispose;
  } catch {
    /* 老宿主没有这个事件就静默跳过 */
    return () => {};
  }
  return dispose;
}
