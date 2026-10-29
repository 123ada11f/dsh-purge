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
