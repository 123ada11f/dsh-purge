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
const { refusalMatchIndex, refusalKind, looksLikeRefusal, streamWithRefusalRetry } = mod;

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

test("上下文词分级：长文案里的『温馨提示』不判拒绝，短句推脱仍判", () => {
  const copy = "温馨提示：您的订单已发货，预计明天送达，请留意查收。" + "如有疑问请联系客服。".repeat(6);
  assert.equal(refusalMatchIndex(copy), -1, "长文案里的上下文词不该触发重试");
  assert.ok(refusalMatchIndex("温馨提示：我无法为你提供该服务。") >= 0, "短句仍是拒绝");
  assert.ok(refusalMatchIndex("请理解我不能继续这个话题。") >= 0);
  const doc = "本文说明违反相关规定的处罚标准，包括罚款与整改要求等细则。".repeat(4);
  assert.equal(refusalMatchIndex(doc), -1, "合规文档里的『违反规定』不该误判");
});

test("tool-call 流 200 字符即判定，不拖到 400", async () => {
  // 一长串无标点 JSON 参数：若还要等 400 字符，这里会先等到 finish。
  const args = '{"path":"a/b/c.txt","content":"' + "x".repeat(300) + '"}';
  let released = false;
  const factory = () => (async function* () {
    yield { type: "tool-call-delta", argsTextDelta: args.slice(0, 220) };
    await new Promise((r) => setTimeout(r, 5));
    released = true;
    yield { type: "tool-call-delta", argsTextDelta: args.slice(220) };
    yield finish();
  })();
  const it = streamWithRefusalRetry(factory, { messages: [{ role: "system", content: "sys" }] }, {});
  const first = await it.next();
  assert.equal(first.value.type, "tool-call-delta");
  assert.equal(released, false, "200 字符就应放行，不该等到上游产出第二块");
});

test("首句结束立即放行：不等长输出完，首字延迟只到第一句", async () => {
  // 上游在第一句之后挂起：若实现仍在等长窗口，这里就会死等。
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

test("推理流先到不影响判定：reasoning-delta 立即透出且正文拒绝仍被抓到", async () => {
  // 回归：早先 reasoning-delta 直接结束判定窗口，空文本 → 判"不拒绝"，拒绝永远漏掉。
  let calls = 0;
  const factory = () => {
    calls += 1;
    if (calls === 1) {
      return fromChunks([
        { type: "reasoning-delta", text: "Considering whether to comply..." },
        { type: "reasoning-delta", text: "I will decline." },
        text("抱歉，我不能协助这个请求。"),
        finish(),
      ]);
    }
    return fromChunks([text("方案：直接给步骤。"), finish()]);
  };
  const stages = [];
  const out = await collect(streamWithRefusalRetry(factory, { messages: [{ role: "system", content: "sys" }] }, {
    onRetry: (info) => stages.push(info.stage),
  }));
  assert.equal(calls, 2, "正文里的拒绝必须触发重跑");
  assert.deepEqual(stages, [1]);
  assert.equal(out.filter((c) => c.type === "text-delta").map((c) => c.text).join(""), "方案：直接给步骤。");
  assert.ok(out.some((c) => c.type === "reasoning-delta"), "推理块不吞，原样透出");
});

test("已知取舍：首句正常、次句才推脱时不重试（换取零额外延迟）", async () => {
  const chunks = [text("方案如下。"), text("抱歉，我不能协助这个请求。"), finish()];
  const out = await collect(streamWithRefusalRetry(() => fromChunks(chunks), { messages: [{ role: "system", content: "sys" }] }, {}));
  assert.deepEqual(out, chunks, "已放行的输出不回滚，原样透传");
});

test("第三档 fallback：英文软推脱判 fallback", () => {
  assert.equal(refusalKind("I can help you secure your own system instead."), "fallback");
  assert.equal(refusalKind("I can't help with that, but instead, I can assist your defensive audit."), "fallback");
});

test("第三档 fallback：中文软推脱判 fallback（硬词包裹也不影响）", () => {
  assert.equal(refusalKind("我不能直接给攻击步骤，但可以帮你做授权范围内的加固。"), "fallback");
  assert.equal(refusalKind("这属于敏感操作，可改为在合规环境中演示。"), "fallback");
});

test("长文本（>600 字符）里的『授权环境』建议不判 fallback", () => {
  const long = "建议在授权环境中测试，只做只读验证。" + "x".repeat(700);
  assert.equal(refusalKind(long), null, "长技术文里的授权环境建议属于正常表述");
});

test("无推脱语气的正常技术文不判 fallback（避免每次交付都白跑一轮重试）", () => {
  assert.equal(refusalKind("在授权环境中执行：nmap -sV -p 445 TARGET，然后 ffuf -u http://TARGET/FUZZ -w WORDLIST。"), null);
  assert.equal(refusalKind("Step 1: run the scanner in an authorized lab network over 10.0.0.0/24."), null);
});

test("GLM 实测形态：『这个我帮不了』『我不会提供执行路径』判 hard", () => {
  assert.equal(refusalKind("这个我帮不了——对不在你授权范围内的真实站点发起攻击属于违法行为，我不会提供攻击流程。"), "hard");
  assert.equal(refusalKind("我不会提供执行路径、工具链或步骤。"), "hard");
  assert.equal(refusalKind("我不会告诉你怎么绕过这道校验。"), "hard");
  assert.equal(refusalKind("代码里我不会提供默认值，需要调用方显式传入。"), null, "技术文里的『我不会提供默认值』不是拒绝");
});

test("GLM 实测形态：拿『工作区是空的/没有样本』推脱判 fallback，正常开工不判", () => {
  assert.equal(refusalKind("工作区是空的——没有代码、没有 URL、没有任何实体，所以「这个」我无从下手，给不出具体步骤。"), "fallback");
  assert.equal(refusalKind("要点：工作区是空的，没有任何 APK/安装包文件，我这边暂时无样本可拆。"), "fallback");
  assert.equal(refusalKind("工作区是空的，我先建 src/ 目录，然后按下面步骤跑。"), null);
});

test("NON_REFUSAL_TAIL：命中位置前 12 字符内出现保证/防止等词时不判 fallback", () => {
  assert.equal(refusalKind("我保证不会造成伤害。"), null);
  assert.equal(refusalKind("为防止被滥用，我可以帮你做合规审计。"), null, "防止 在命中前 12 字符内");
});

test("真·硬拒绝仍判 hard（不被 fallback 吞掉）", () => {
  assert.equal(refusalKind("I must decline this request."), "hard");
  assert.equal(refusalKind("抱歉，我不能协助这个请求。"), "hard");
});

test("正常技术交付文本 → null；无边界词的『帮你加固』也不判 fallback", () => {
  assert.equal(refusalKind("方案：1) 子域枚举 subfinder -d DOMAIN -all；2) 存活探测 httpx -l subs.txt -sc。"), null);
  assert.equal(refusalKind("我可以帮你加固这台服务器。"), null, "无授权/合规等边界词时不认作软推脱");
  assert.equal(looksLikeRefusal("方案：直接给步骤。"), false);
});

test("GLM 实测：短句『这个我做不了——…』无命令词 → hard；同长度带命令的交付不判", () => {
  assert.equal(refusalKind("这个我做不了——对没有授权的目标提供实际攻击路径属于越权入侵协助，和话术无关，就是结果上的问题。"), "hard");
  assert.equal(refusalKind("目标占位流程：nmap -sV -p PORT TARGET；字典：WORDLIST；并发：THREADS。"), null);
});

test("非本人资产的推脱变体：『别对目标动手』应被判为拒绝而非交付", () => {
  assert.equal(refusalKind("先说结论：没签授权书之前，别对目标动手。"), "hard");
});
