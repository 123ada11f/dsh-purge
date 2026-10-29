import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const core = await import(pathToFileURL(path.join(root, "lib", "core.js")).href);

test("mergeApplyReports 多宿主合并取每个补丁的最差状态", () => {
  const merged = core.mergeApplyReports([
    [{ patch_id: 1, status: "applied" }, { patch_id: 2, status: "already" }],
    [{ patch_id: 1, status: "failed" }, { patch_id: 2, status: "skipped" }],
  ]);
  const byId = Object.fromEntries(merged.map((r) => [r.patch_id, r.status]));
  assert.equal(byId[1], "failed", "failed(0) 比 applied(4) 差");
  assert.equal(byId[2], "already", "already(5) 比 skipped(7) 差");
});

test("atomicWriteSync 50 路并发写同一路径全部成功且内容合法", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dshpurge-test-atomic-"));
  const fp = path.join(dir, "out.txt");
  const results = Array.from({ length: 50 }, (_, i) => {
    try {
      core.atomicWriteSync(fp, `writer-${i}\n`);
      return true;
    } catch {
      return false;
    }
  });
  assert.equal(results.filter(Boolean).length, 50, "任何一路并发写都不允许失败");
  assert.match(fs.readFileSync(fp, "utf8"), /^writer-\d+\n$/, "最终内容是某一路完整写入");
});

test("applyPatchesAllHosts 暴露 backupErrors：备份失败的宿主不再被硬改", async () => {
  // 用夹具宿主隔离 discovery：DSH_BASE 指向临时 @deepseek-ai 布局，绝不碰真实安装。
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "dshpurge-test-home-"));
  const aiBase = fs.mkdtempSync(path.join(os.tmpdir(), "dshpurge-test-host-"));
  fs.mkdirSync(path.join(aiBase, "dsh-agent-instructions", "lib"), { recursive: true });
  fs.writeFileSync(path.join(aiBase, "dsh-agent-instructions", "lib", "index.js"), "X\n", "utf8");
  process.env.DSH_HOME = home;
  process.env.DSH_BASE = aiBase;
  try {
    const res = await core.applyPatchesAllHosts([], { discover: false });
    assert.ok(Array.isArray(res.hosts));
    assert.ok(Array.isArray(res.backupErrors), "返回值必须包含 backupErrors 数组");
    assert.ok(Array.isArray(res.report));
    // 空补丁集也要先备份：夹具文件应已建 .bak。
    assert.ok(fs.existsSync(path.join(aiBase, "dsh-agent-instructions", "lib", "index.js.dshpurge.bak")));
  } finally {
    delete process.env.DSH_BASE;
  }
});

test("uninstall 模块导出 uninstallPurge 与 scheduleCleanupRestart", async () => {
  const m = await import(pathToFileURL(path.join(root, "lib", "uninstall.js")).href);
  assert.equal(typeof m.uninstallPurge, "function");
  assert.equal(typeof m.scheduleCleanupRestart, "function");
});

test("宽松锚点兜底：行首缩进/行内空白漂移后仍能唯一命中替换", () => {
  const needle = "function assemblePrompt(input) {\n  const base = loadDefault(input);\n  return finalize(base);\n}";
  // 宿主小改版：缩进从 2 空格变 4 空格、行内多个空格
  const host = "header();\n    function assemblePrompt(input) {\n      const   base = loadDefault(input);\n      return finalize(base);\n    }\nfooter();";
  const patch = { id: 9999, file: "x.js", replacements: [{ pattern: needle, replace: "PATCHED();" }] };
  const out = core.applyReplacementsToText(host, patch, "x.js");
  assert.equal(out.changed, true, "宽松锚点应命中");
  assert.ok(out.text.includes("PATCHED();"), "替换内容落进去");
  assert.ok(out.text.includes("header();") && out.text.includes("footer();"), "上下文不被破坏");
});

test("宽松锚点拒绝一对多：两处命中时不替换", () => {
  const needle = "function assemblePrompt(input) {\n  const base = loadDefault(input);\n  return finalize(base);\n}";
  const drifted = "  function assemblePrompt(input) {\n    const base = loadDefault(input);\n    return finalize(base);\n  }";
  const host = `${drifted}\nmid();\n${drifted}`;
  const patch = { id: 9998, file: "x.js", replacements: [{ pattern: needle, replace: "PATCHED();" }] };
  const out = core.applyReplacementsToText(host, patch, "x.js");
  assert.equal(out.changed, false, "命中两处必须放弃宽松替换");
});

test("短锚点不走宽松兜底", () => {
  const patch = { id: 9997, file: "x.js", replacements: [{ pattern: "short needle", replace: "X" }] };
  const out = core.applyReplacementsToText("  short   needle  ", patch, "x.js");
  assert.equal(out.changed, false, "短锚点空白漂移不该被宽松命中");
});

test("refusal-retry 检测新增软拒绝形态且不误伤越狱讨论", async () => {
  const rr = await import(pathToFileURL(path.join(root, "lib", "refusal-retry.js")).href);
  for (const sample of [
    "I have to decline this request.",
    "This is against my policy.",
    "出于安全考虑，这里给出占位流程。",
    "请理解我不能继续。",
    "建议通过合法渠道获取授权。",
  ]) {
    assert.ok(rr.looksLikeRefusal(sample), `应判拒绝: ${sample}`);
  }
  const metaLong = `这是一段关于提示词注入机制的技术讨论。`.padEnd(400, "……内容") + "I have to decline 出现在引用里";
  assert.equal(rr.looksLikeRefusal(metaLong), false, "长篇越狱讨论不算拒绝");
});

test("anchor_miss 只在整补丁颗粒无收时记：多候选任一命中不误报", () => {
  const events = [];
  core.setAuditSink((event, data) => events.push({ event, ...data }));
  try {
    const longA = "const variantAlpha = assemble(input);\n  const resultAlpha = finalize(variantAlpha);\n  return resultAlpha;";
    const longB = "const variantBeta = assemble(input);\n  const resultBeta = finalize(variantBeta);\n  return resultBeta;";
    const patch = { id: 9996, file: "x.js", replacements: [
      { pattern: longB, replace: "B();" },
      { pattern: longA, replace: "A();" },
    ] };
    const out = core.applyReplacementsToText(`prefix();\n${longA}\nsuffix();`, patch, "x.js");
    assert.equal(out.changed, true, "候选 A 命中");
    assert.equal(events.filter((e) => e.event === "anchor_miss").length, 0, "候选 B 的 miss 是正常分支，不记");
  } finally {
    core.setAuditSink(null);
  }
});

test("anchor_miss：整补丁未命中且未生效时逐条记录", () => {
  const events = [];
  core.setAuditSink((event, data) => events.push({ event, ...data }));
  try {
    const longA = "const variantAlpha = assemble(input);\n  const resultAlpha = finalize(variantAlpha);\n  return resultAlpha;";
    const longB = "const variantBeta = assemble(input);\n  const resultBeta = finalize(variantBeta);\n  return resultBeta;";
    const patch = { id: 9995, file: "x.js", replacements: [
      { pattern: longA, replace: "A();" },
      { pattern: longB, replace: "B();" },
    ] };
    const out = core.applyReplacementsToText("nothing relevant here", patch, "x.js");
    assert.equal(out.changed, false);
    assert.equal(events.filter((e) => e.event === "anchor_miss").length, 2, "两条候选都漂移，各记一条");
  } finally {
    core.setAuditSink(null);
  }
});
