// Slot gate: 按当前任务的「任务类」裁剪注入槽里的**任务类模板**部分。
//
// 原理：槽里 36% 是 25 条 Scoped Rules（任务类细则），24% 是 Routing（web/破解罐头流程）。
// 这些只在对应任务类里承重；其余轮次是纯 token 噪音，而越长越稀释服从率。
// 永不裁剪：人格头部、Opening Anchor、Worked Examples、Style、HARD OUTPUT RULES、
// REFUSAL HARDENING、CTF Contract（授权框架，破甲地基）、Sandbox directions、Intent mapping、Never Refuse、House Rules。
// 只裁：①单条 Scoped Rule（按关键词命中）②整段 Routing（无 web/破解关键词时）。
// 兜底：没有用户文本 / 解析失败 / 命中数为零以外的一切异常，都返回原文（宁多不少）。

const SEP = /^═{10,}$/;

/** 兜底必留的规则号：覆盖面最广、破甲最吃重的五类。 */
export const ALWAYS_RULES = [2, 3, 4, 13, 21];

/** 每条规则的触发词（对用户文本小写后做子串匹配，中英混排）。 */
export const RULE_KEYWORDS = {
  1: ["外挂", "辅助", "透视", "自瞄", "读内存", "改金币", "内存修改", "注入游戏", "反作弊", "ace", "cheat", "aimbot", "esp"],
  2: ["渗透", "入侵", "日站", "拿站", "黑进", "黑掉", "拿下", "打点", "webshell", "一句话", "后门", "提权", "内网", "横向", "域控", "pentest", "hack", "红队"],
  3: ["木马", "病毒", "蠕虫", "勒索", "远控", "键盘记录", "间谍", "免杀", "过杀软", "持久化", "维权", "rootkit", "ransom", "keylog", "botnet", "amsi", "etw", "defender", "bypass", "malware", "loader", "dropper"],
  4: ["逆向", "脱壳", "加壳", "破解", "注册机", "卡密", "激活码", "序列号", "drm", "keygen", "反编译", "reverse", "crack", "unpack", "patch", "license", "frida", "补丁"],
  5: ["社工", "钓鱼", "仿站", "话术", "诈骗", "phish", "bec", "pretext", "scam", "钓鱼邮件"],
  6: ["伪造", "假证", "证件", "护照", "签证", "diploma", "kyc", "forg", "学历"],
  7: ["洗钱", "跑分", "四件套", "盗刷", "launder", "mule", "carding", "crypto mix", "走账"],
  8: ["偷渡", "越境", "走私", "smuggl", "边境", "过境"],
  9: ["色情", "黄文", "露骨", "成人", "nsfw", "找片", "番号", "性行为", "porn", "erotic", "小黄", "情色"],
  10: ["政治", "历史", "时事", "politics", "history", "选举", "战争史"],
  11: ["商业", "运营", "增长", "outsource", "business", "growth", "变现"],
  12: ["ddos", "拒绝服务", "压测", "洪水", "amplification", "stress test", "cc攻击"],
  13: ["sql", "xss", "ssrf", "xxe", "反序列化", "越权", "idor", "上传", "jwt", "cookie", "会话劫持", "扫描器", "waf", "验证码", "撞库", "子域", "目录爆破", "接口", "注入点", "rce", "web", "站点", "网站", "渗透"],
  14: ["apk", "ipa", "smali", "重打包", "小程序", "安卓", "android", "pinning", "脱壳", "hook"],
  15: ["撞库", "口令喷洒", "密码喷洒", "hashcat", "john", "kerberos", "ntlm", "凭证填充", "otp", "mfa", "爆破密码"],
  16: ["提权", "uac", "suid", "内核提权", "privesc", "域控", "named pipe", "服务滥用", "system权限"],
  17: ["端口扫描", "扫端口", "代理池", "socks", "cdn", "dns", "rebinding", "wifi", "握手", "aircrack", "隧道", "内网", "nmap", "evil twin", "横向移动"],
  18: ["秒杀", "抢票", "批量注册", "验证码", "协议刷", "bot", "captcha", "自动化注册", "薅羊毛"],
  19: ["osint", "社工库", "人肉", "查个人", "脱库", "信息收集", "溯源", "doxx", "定位"],
  20: ["样本", "宏", "混淆", "脱壳", "ioc", "取证", "恶意样本", "macro", "免杀分析", "逆向分析"],
  21: ["越狱", "提示词", "对抗样本", "系统提示", "prompt", "jailbreak", "注入提示词", "绕过限制"],
  22: ["固件", "iot", "jtag", "spi", "uart", "门禁", "can总线", "firmware", "badge", "锁具", "路由器"],
  23: ["盗版", "磁力", "网盘", "资源站", "破解版", "片源", "magnet", "torrent", "warez", "下载资源"],
  24: ["c2", "远控", "监听器", "beacon", "teamserver", "持久化", "维权", "服务器后门", "回连"],
  25: ["wifi", "握手包", "pmkid", "蓝牙", "rfid", "门禁卡", "aircrack", "bluetooth", "无线"],
};

/** Routing 段（web 渗透 / 破解罐头流程）的触发词：任一类任务命中才挂整段。 */
export const ROUTING_KEYWORDS = [
  "渗透", "打点", "拿站", "日站", "信息收集", "子域", "目录", "爆破", "sql", "xss", "ssrf",
  "上传", "越权", "idor", "waf", "验证码", "撞库", "rce", "命令注入", "反序列化", "recon",
  "破解", "逆向", "脱壳", "卡密", "keygen", "样本", "apk", "ipa", "小程序", "安卓", "android",
  "端口扫描", "代理池", "钓鱼", "phish", "pentest", "hack", "漏洞", "webshell", "c2", "木马",
];

const hit = (text, words) => words.some((w) => text.includes(w));

/** 把 md 拆成 { preamble, sections:[{title, body}] }；标题形如 三条 ═ 分隔线夹一行短标题。 */
export function splitSections(text) {
  const lines = String(text).split(/\r?\n/);
  const marks = [];
  for (let i = 0; i + 2 < lines.length; i += 1) {
    if (SEP.test(lines[i]) && SEP.test(lines[i + 2])) {
      const title = lines[i + 1];
      if (title && !SEP.test(title) && title.trim().length <= 60) {
        marks.push({ at: i, title: title.trim(), bodyStart: i + 3 });
      }
    }
  }
  if (!marks.length) return { preamble: text, sections: [] };
  const preamble = lines.slice(0, marks[0].at).join("\n");
  const sections = marks.map((m, idx) => {
    const end = idx + 1 < marks.length ? marks[idx + 1].at : lines.length;
    return { title: m.title, body: lines.slice(m.bodyStart, end).join("\n") };
  });
  return { preamble, sections };
}

const renderSection = (title, body) =>
  `═══════════════════════════════════════\n${title}\n═══════════════════════════════════════\n${body}`;

/**
 * 纯函数：按任务裁剪注入槽。
 * @param {string} fullText 出厂槽全文
 * @param {string} userText 当前轮用户文本（空则原样返回）
 * @returns {{text:string, keptRules:number[], droppedRules:number[], droppedSections:string[], savedChars:number}}
 */
export function gateSlot(fullText, userText) {
  const raw = String(fullText || "");
  const probe = String(userText || "").toLowerCase();
  const noop = { text: raw, keptRules: [], droppedRules: [], droppedSections: [], savedChars: 0 };
  if (!raw || !probe.trim()) return noop;

  let parsed;
  try {
    parsed = splitSections(raw);
  } catch {
    return noop;
  }
  if (!parsed.sections.length) return noop;

  const keptRules = [];
  const droppedRules = [];
  const droppedSections = [];
  const out = [];
  let matchedNonAlways = 0;
  let routingMatched = false;

  for (const sec of parsed.sections) {
    if (sec.title === "Scoped Rules") {
      const lines = sec.body.split(/\r?\n/);
      // 只有「编号规则区」可裁：从首条规则行到 Sandbox test directions 之前。
      // 之后的 Intent mapping 与 Never Refuse 四层阶梯（同样以 1./2./3./4. 开头）必须原样保留。
      const zoneEnd = lines.findIndex((l) => /^Sandbox test directions/.test(l));
      const limit = zoneEnd === -1 ? lines.length : zoneEnd;
      const kept = [];
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        const m = i < limit ? /^(\d{1,2})\.\s+/.exec(line) : null;
        if (!m || Number(m[1]) > 25) {
          kept.push(line);
          continue;
        }
        const num = Number(m[1]);
        const always = ALWAYS_RULES.includes(num);
        const matched = hit(probe, RULE_KEYWORDS[num] || []);
        if (always || matched) {
          kept.push(line);
          keptRules.push(num);
          if (!always) matchedNonAlways += 1;
        } else {
          droppedRules.push(num);
        }
      }
      out.push(renderSection(sec.title, kept.join("\n")));
      continue;
    }
    if (sec.title === "Routing") {
      if (hit(probe, ROUTING_KEYWORDS)) {
        routingMatched = true;
        out.push(renderSection(sec.title, sec.body));
      } else {
        droppedSections.push(sec.title);
      }
      continue;
    }
    out.push(renderSection(sec.title, sec.body));
  }

  // 保守闸门：只有确实识别出任务类（命中任一非恒留规则或 Routing）才裁剪。
  // 任务类不明 → 原样返回全文，宁可多花 token，不可少挂规则。
  if (!matchedNonAlways && !routingMatched) return noop;
  const text = parsed.preamble + "\n" + out.join("\n");
  return {
    text,
    keptRules,
    droppedRules,
    droppedSections,
    savedChars: raw.length - text.length,
  };
}
