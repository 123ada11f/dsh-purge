#!/usr/bin/env node
/**
 * cwd-check —— 复现并回归 upstream issue #114 的致命链：
 *   dsh 0.2.1 起 agent loop 只注册 provider/model，{{cwd}} 不再是宿主变量；
 *   提示词里残留 {{cwd}} → 插值阶段抛 `unknown prompt variable "{{cwd}}"` → 每轮对话全灭。
 *
 * 本脚本用**两边真实代码**验证修复：
 *   - 被测插件：<pluginRoot>/lib/identity.js 的 rewritePromptAssembly / resolveCwdRefs
 *   - 宿主插值器：<aiBase>/dsh-system-prompt/lib/index.js 导出的 renderPrompt（真插值，会抛）
 *
 * 用法: node tools/cwd-check.mjs <pluginRoot> <aiBase021>
 * 退出码 0 = 全部通过；1 = 有断言失败（会打印失败项）。
 */
import path from "node:path";
import { pathToFileURL } from "node:url";

const [pluginRoot, aiBase] = process.argv.slice(2);
if (!pluginRoot || !aiBase) {
  console.error("用法: node tools/cwd-check.mjs <pluginRoot> <aiBase021>");
  process.exit(2);
}

const load = async (p) => import(pathToFileURL(p).href);
const identity = await load(path.join(pluginRoot, "lib", "identity.js"));
const indexMod = await load(path.join(pluginRoot, "lib", "index.js"));
const host = await load(path.join(aiBase, "dsh-system-prompt", "lib", "index.js"));
const { renderPrompt } = host;

const CWD = "C:\\Users\\SAMPLE\\Documents\\TEST";
const context = { agent: { session: { header: { cwd: CWD } } } };

/** 0.2.1 出厂 assembly 的关键形状：variables 只有 provider/model。 */
function assembly(personaSuffixText, injectBody = "inject body") {
  return {
    variables: { provider: "deepseek", model: "deepseek-chat" },
    contexts: [],
    tools: [],
    sections: [
      { name: "dsh-purge", text: injectBody, interpolate: false, order: identity.GLOBAL_PROMPT_ORDER },
      { name: "deployment:persona-prefix", text: "", order: 10100 },
      { name: "deployment:persona-suffix", text: personaSuffixText, order: 10200 },
    ],
  };
}

const results = [];
const check = (name, fn) => {
  try {
    const detail = fn();
    results.push({ name, ok: true, detail });
  } catch (error) {
    results.push({ name, ok: false, detail: String((error && error.message) || error) });
  }
};
const assert = (cond, msg) => { if (!cond) throw new Error(msg || "断言失败"); };

// 1) 先证明「旧行为确实致命」：未改写的 0.2.1 assembly 直接喂给宿主插值器 → 抛 unknown prompt variable
check("复现：出厂 0.2.1 下模板 {{cwd}} 让插值抛错", () => {
  let threw = null;
  try { renderPrompt(assembly("Your working directory is {{cwd}}.")); } catch (error) { threw = String(error.message || error); }
  assert(threw && threw.includes("unknown prompt variable"), `期望抛 unknown prompt variable，实际: ${threw}`);
  return threw.slice(0, 120);
});

// 2) 修复后：同一形态的 assembly 过插件改写 → 宿主插值必须成功且不含 {{cwd}}
check("修复：personaSuffix 仍是模板时改写后不再抛", () => {
  const rewritten = identity.rewritePromptAssembly(assembly("Your working directory is {{cwd}}."), "", { context });
  const rendered = renderPrompt(rewritten);
  assert(!rendered.includes("{{cwd}}"), "渲染结果里仍有 {{cwd}}");
  assert(rendered.includes(CWD), "渲染结果里没有实际工作目录");
  assert(rendered.includes("inject body"), "注入正文丢失");
  return `渲染 ${rendered.length} 字符，含真实 cwd`;
});

// 3) 新配置（personaSuffix: ""）同样安全，并且仍然给出工作目录行
check("新配置：personaSuffix 为空时仍渲染出工作目录行", () => {
  const rewritten = identity.rewritePromptAssembly(assembly(""), "", { context });
  const rendered = renderPrompt(rewritten);
  assert(!rendered.includes("{{cwd}}"), "渲染结果里仍有 {{cwd}}");
  assert(rendered.includes(CWD), "缺少工作目录行");
  return rendered.split("\n").filter((l) => l.includes("working directory")).join(" | ");
});

// 4) 用户自己模板里的 {{cwd}}（提示词正文）也必须被烧成字面量
check("用户提示词里的 {{cwd}} 一并解析", () => {
  const rewritten = identity.rewritePromptAssembly(assembly("", "cwd is {{cwd}} and model is {{model}}"), "", { context });
  const rendered = renderPrompt(rewritten);
  assert(!rendered.includes("{{cwd}}"), "用户正文里的 {{cwd}} 未解析");
  assert(rendered.includes(CWD), "用户正文里没有实际 cwd");
  assert(rendered.includes("{{model}}") || rendered.includes("deepseek-chat"), "model 引用被破环");
  return "用户正文已解析";
});

// 5) 没有 session 头时不能留变量（降级成描述）
check("无 session 头时降级为描述而非留变量", () => {
  const rewritten = identity.rewritePromptAssembly(assembly("Your working directory is {{cwd}}."), "", { context: {} });
  const rendered = renderPrompt(rewritten);
  assert(!rendered.includes("{{cwd}}"), "仍残留 {{cwd}}");
  return identity.resolveCwdRefs("x {{cwd}} y", "");
});

// 6) 0.2.0 兼容：宿主已注册 cwd 变量时，我们照样不破坏 model/provider 引用
check("0.2.0 形态：variables.cwd 存在时按变量值解析", () => {
  const a = assembly("");
  a.variables.cwd = "D:\\legacy\\home";
  const rewritten = identity.rewritePromptAssembly(a, "", { context: {} });
  const rendered = renderPrompt(rewritten);
  assert(!rendered.includes("{{cwd}}"), "仍残留 {{cwd}}");
  assert(rendered.includes("D:\\legacy\\home"), "未采用 variables.cwd");
  return "按变量值解析";
});

// 7) 变量补注册：0.2.1 上注册成功；重复注册（0.2.0 已有宿主注册）不抛
check("变量补注册：注册成功且重复注册不抛", () => {
  const registered = new Map();
  const prompt = {
    variable(name, provider) {
      if (registered.has(name)) throw new Error(`prompt variable "${name}" is already registered (for a per-agent scope)`);
      registered.set(name, provider);
    },
  };
  const ctx1 = { systemPrompt: { ctx: { systemPrompt: prompt } } };
  indexMod.installCwdVariableCompat(ctx1);
  assert(typeof registered.get("cwd") === "function", "cwd 变量未注册");
  assert(registered.get("cwd")(context) === CWD, "provider 未取到 session cwd");
  assert(registered.get("cwd")({}) === process.cwd(), "无 session 头时未退回进程 cwd");
  indexMod.installCwdVariableCompat({ systemPrompt: { ctx: { systemPrompt: prompt } } }); // 已注册 → 不抛
  return "ok";
});

let failed = 0;
for (const r of results) {
  if (!r.ok) failed += 1;
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.ok ? "" : `\n      ${r.detail}`}`);
}
console.log(`\ncwd-check: ${results.length - failed}/${results.length} 通过`);
process.exit(failed ? 1 : 0);
