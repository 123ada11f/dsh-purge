import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// 隔离 DSH_HOME，避免 dropStaleUserProfilePatchBackups 碰真实宿主目录。
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "dshpurge-test-home-"));
process.env.DSH_HOME = tmpHome;

const core = await import(pathToFileURL(path.join(root, "lib", "core.js")).href);

function makeAiBase() {
  const aiBase = fs.mkdtempSync(path.join(os.tmpdir(), "dshpurge-test-host-"));
  const target = path.join(aiBase, "dsh-agent-instructions", "lib", "index.js");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, "ORIGINAL_CONTENT\n", "utf8");
  return { aiBase, target };
}

test("backupAll 为目标文件建 .dshpurge.bak，二次调用不覆盖已有备份", async () => {
  const { aiBase, target } = makeAiBase();
  const bak = target + ".dshpurge.bak";
  const first = await core.backupAll(aiBase);
  assert.deepEqual(first.errors, []);
  assert.ok(fs.existsSync(bak));
  assert.equal(fs.readFileSync(bak, "utf8"), "ORIGINAL_CONTENT\n");
  fs.writeFileSync(target, "PATCHED\n", "utf8");
  const second = await core.backupAll(aiBase);
  assert.deepEqual(second.errors, []);
  assert.equal(fs.readFileSync(bak, "utf8"), "ORIGINAL_CONTENT\n", "已有备份不被补丁态覆盖");
});

test("revertAll 从 bak 还原并删除 bak；无 bak 的目标只跳过绝不删除（#41）", async () => {
  const { aiBase, target } = makeAiBase();
  await core.backupAll(aiBase);
  fs.writeFileSync(target, "PATCHED\n", "utf8");
  const r1 = await core.revertAll(aiBase);
  assert.deepEqual(r1.errors, []);
  assert.equal(fs.readFileSync(target, "utf8"), "ORIGINAL_CONTENT\n");
  assert.ok(!fs.existsSync(target + ".dshpurge.bak"));

  // 无备份场景：文件存在但从未备份，revertAll 不得删除它。
  const r2 = await core.revertAll(aiBase);
  assert.deepEqual(r2.errors, []);
  assert.ok(r2.skipped.includes(target));
  assert.ok(fs.existsSync(target), "无 bak 时目标文件必须保留");
});

test("用户 patch 层 profiles/<name>/cordis.patch.yml 永不建 bak 也不还原（#43）", async () => {
  const { aiBase } = makeAiBase();
  const userPatch = path.join(tmpHome, "profiles", "default", "cordis.patch.yml");
  fs.mkdirSync(path.dirname(userPatch), { recursive: true });
  fs.writeFileSync(userPatch, "name: user-layer\n", "utf8");
  // 历史误建的 bak 只丢不还原。
  fs.writeFileSync(userPatch + ".dshpurge.bak", "name: stale\n", "utf8");
  const b = await core.backupAll(aiBase);
  assert.ok(!b.made.some((p) => p.includes("profiles")), "用户 patch 层不进备份");
  await core.revertAll(aiBase);
  assert.equal(fs.readFileSync(userPatch, "utf8"), "name: user-layer\n", "用户文件内容不被 bak 覆盖");
  assert.ok(!fs.existsSync(userPatch + ".dshpurge.bak"), "历史误建 bak 已丢弃");
});

test("isUserProfilePatchFile 只认 profiles/<name>/cordis.patch.yml", () => {
  assert.equal(core.isUserProfilePatchFile("C:\\x\\profiles\\default\\cordis.patch.yml"), true);
  assert.equal(core.isUserProfilePatchFile("/home/u/.dsh/profiles/web/cordis.patch.yml"), true);
  assert.equal(core.isUserProfilePatchFile("C:\\x\\dsh-web-app\\cordis.patch.yml"), false);
});
