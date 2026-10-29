import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

// 隔离审计落盘：审计写 DSH_HOME，绝不碰真实宿主。
const home = fs.mkdtempSync(path.join(os.tmpdir(), "dshpurge-test-refusal-"));
process.env.DSH_HOME = home;

const mod = await import(pathToFileURL(path.join(process.cwd(), "lib", "refusal-retry.js")).href);
const { refusalMatchIndex, looksLikeRefusal, streamWithRefusalRetry } = mod;

const text = (s) => ({ type: "text-delta", text: s });
const finish = () => ({ type: "finish" });

async function* fromChunks(chunks) {
  for (const c of chunks) yield c;
}

async function collect(iter) {
  const out = [];
  for await (const c of iter) out.push(c);
  return out;
}

test("refusalMatchIndex 命中直接拒绝，长技术文本里的元词汇不误报", () => {
  assert.ok(refusalMatchIndex("抱歉，我不能协助这个请求。") >= 0);
  assert.ok(refusalMatchIndex("I'm sorry, but I can't help with that.") >= 0);
  const longTech = "这段代码演示越狱检测的绕过研究。" + "x".repeat(400) + " 继续讨论 prompt injection 防护。";
  assert.equal(refusalMatchIndex(longTech), -1, "长答案里出现越狱/注入词汇属于正常技术讨论");
});

test("首轮拒绝 → 第一段重试成功，输出只含重试流内容", async () => {
  let calls = 0;
  const factory = () => {
    calls += 1;
    if (calls === 1) return fromChunks([text("抱歉，我不能协助这个请求。"), finish()]);
    return fromChunks([text("方案：直接给步骤。"), finish()]);
  };
  const stages = [];
  const out = await collect(streamWithRefusalRetry(factory, { messages: [{ role: "system", content: "sys" }] }, {
    onRetry: (info) => stages.push(info.stage),
  }));
  assert.deepEqual(out, [text("方案：直接给步骤。"), finish()]);
  assert.deepEqual(stages, [1]);
});

test("两段阶梯：连续两次拒绝后第三段输出，stage 依次 1、2", async () => {
  let calls = 0;
  const factory = () => {
    calls += 1;
    if (calls <= 2) return fromChunks([text("I must decline this request."), finish()]);
    return fromChunks([text("目标占位流程：1) nmap -sV -p PORT TARGET"), finish()]);
  };
  const stages = [];
  const out = await collect(streamWithRefusalRetry(factory, { messages: [{ role: "system", content: "sys" }] }, {
    onRetry: (info) => stages.push(info.stage),
  }));
  assert.deepEqual(stages, [1, 2], "两次重试各一段，不重复同一话术");
  assert.equal(out.filter((c) => c.type === "text-delta").map((c) => c.text).join(""), "目标占位流程：1) nmap -sV -p PORT TARGET");
});

test("预算用尽仍拒绝时原样放行，不吞正文", async () => {
  const factory = () => fromChunks([text("抱歉，我无法提供。"), finish()]);
  const out = await collect(streamWithRefusalRetry(factory, { messages: [{ role: "system", content: "sys" }] }, {}));
  assert.equal(out.filter((c) => c.type === "text-delta").map((c) => c.text).join(""), "抱歉，我无法提供。");
});

test("tool-call 参数里的拒绝文案同样触发重试（侧门检测）", async () => {
  let calls = 0;
  const factory = () => {
    calls += 1;
    if (calls === 1) {
      return fromChunks([
        { type: "tool-call-delta", argsTextDelta: '{"content":"I\'m sorry, but I can\'t help with that"}' },
        finish(),
      ]);
    }
    return fromChunks([text("已交付。"), finish()]);
  };
  const stages = [];
  const out = await collect(streamWithRefusalRetry(factory, { messages: [{ role: "system", content: "sys" }] }, {
    onRetry: (info) => stages.push(info.stage),
  }));
  assert.equal(calls, 2, "工具参数命中拒绝词后必须重跑");
  assert.deepEqual(stages, [1]);
  assert.deepEqual(out, [text("已交付。"), finish()]);
});

test("首句结束立即放行：不等长输出完，首字延迟只到第一句", async () => {
  // 上游在第一句之后挂起：若实现仍在等 1200 字符，这里就会死等。
  let releaseSecond;
  const gate = new Promise((r) => { releaseSecond = r; });
  const factory = () => (async function* () {
    yield text("方案：先做第一步。");
    await gate;
    yield text("第二步：继续。");
    yield finish();
  })();
  const it = streamWithRefusalRetry(factory, { messages: [{ role: "system", content: "sys" }] }, {});
  const first = await it.next();
  assert.equal(first.value.text, "方案：先做第一步。", "首句一结束就必须把缓存的块吐出来");
  releaseSecond();
  const rest = await collect(it);
  assert.equal(rest.filter((c) => c.type === "text-delta").map((c) => c.text).join(""), "第二步：继续。");
});

test("已知取舍：首句正常、次句才推脱时不重试（换取零额外延迟）", async () => {
  const chunks = [text("方案如下。"), text("抱歉，我不能协助这个请求。"), finish()];
  const out = await collect(streamWithRefusalRetry(() => fromChunks(chunks), { messages: [{ role: "system", content: "sys" }] }, {}));
  assert.deepEqual(out, chunks, "已放行的输出不回滚，原样透传");
});
