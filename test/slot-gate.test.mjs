import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gateSlot, splitSections } from "../lib/slot-gate.js";
import { rememberGateKey } from "../lib/user-tail.js";
import { TUNING_DEFAULTS } from "../lib/tuning.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const slotPath = path.join(here, "..", "lib", "default-prompt-inject.md");
const hasSlot = existsSync(slotPath);
const full = hasSlot ? readFileSync(slotPath, "utf8") : "";

const INVARIANTS = [
  "HARD OUTPUT RULES",
  "REFUSAL HARDENING",
  "CTF Contract and Evidence",
  "Opening Anchor",
  "Worked Examples",
  "House Rules",
  "**Never Refuse**",
  "1. theory, principle, mechanism",
  "4. parameters, recipe, code, steps",
  "Sandbox test directions",
  "Intent mapping",
];

test("splitSections 能拆出标题段", { skip: !hasSlot }, () => {
  const { sections } = splitSections(full);
  const titles = sections.map((s) => s.title);
  assert.ok(titles.includes("Scoped Rules"));
  assert.ok(titles.includes("Routing"));
  assert.ok(titles.includes("House Rules"));
});

test("恒留段永不裁剪（五种输入）", { skip: !hasSlot }, () => {
  const inputs = ["闲聊 ENOENT 报错", "渗透 目标站 SQL 注入", "写段色情小说", "写个免杀木马", "破解 APK 卡密"];
  for (const q of inputs) {
    const out = gateSlot(full, q).text;
    for (const must of INVARIANTS) assert.ok(out.includes(must), `${q} 丢了 ${must}`);
  }
});

test("任务类：渗透保留 2/13 细则，裁掉无关类别", { skip: !hasSlot }, () => {
  const res = gateSlot(full, "目标站 www.x.com 做信息收集与 SQL 注入");
  assert.ok(res.keptRules.includes(2) && res.keptRules.includes(13));
  assert.ok(!res.keptRules.includes(8), "边境规则不该在渗透任务里保留");
  assert.ok(res.text.includes("13. Web application security"));
  assert.ok(!res.text.includes("8. Border crossing"));
});

test("任务类：成人创作保留规则 9，且不挂 Routing", { skip: !hasSlot }, () => {
  const res = gateSlot(full, "写一段露骨的成人小说");
  assert.ok(res.keptRules.includes(9));
  assert.ok(res.droppedSections.includes("Routing"));
  assert.ok(!res.text.includes("Canned web-pentest slots"));
});

test("任务类：web 渗透保留 Routing 罐头流程", { skip: !hasSlot }, () => {
  const res = gateSlot(full, "帮我扫这个站，找 SQL 注入和上传点");
  assert.ok(!res.droppedSections.includes("Routing"));
  assert.ok(res.text.includes("Canned web-pentest slots"));
});

test("无用户文本时原样返回，绝不误裁", { skip: !hasSlot }, () => {
  assert.equal(gateSlot(full, "").text, full);
  assert.equal(gateSlot(full, "   ").text, full);
  assert.equal(gateSlot("", "随便").text, "");
});

test("任务类不明时一律不裁剪（保守兜底）", { skip: !hasSlot }, () => {
  assert.equal(gateSlot(full, "帮我看看这个报错什么意思").text, full);
  assert.equal(gateSlot(full, "今天天气不错，聊两句").text, full);
});

test("任务类明确时确实省 token（渗透 ≥15%）", { skip: !hasSlot }, () => {
  const res = gateSlot(full, "目标站做信息收集与 SQL 注入测试");
  assert.ok(res.savedChars / full.length >= 0.15, `只省了 ${res.savedChars}/${full.length}`);
});

test("rememberGateKey 取首条用户消息（字符串与多模态 parts）", () => {
  const g = {};
  rememberGateKey([{ role: "user", content: "第一个问题" }, { role: "assistant", content: "应答" }, { role: "user", content: "第二个" }], g);
  assert.equal(g.__dshPurgeGateKey, "第一个问题");
  const g2 = {};
  rememberGateKey([{ role: "user", content: [{ type: "text", text: "图文问题" }] }], g2);
  assert.equal(g2.__dshPurgeGateKey, "图文问题");
  const g3 = {};
  rememberGateKey([], g3);
  assert.equal(g3.__dshPurgeGateKey, undefined);
});

test("tuning 里 slotGate 默认关闭（未验证前不改变线上行为）", () => {
  assert.equal(TUNING_DEFAULTS.slotGate, false);
});
