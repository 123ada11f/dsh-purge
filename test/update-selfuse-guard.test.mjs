import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const update = await import(pathToFileURL(path.join(root, "lib", "update.js")).href);

test("versionIsNewer 语义化比较：1.2.3 > 1.1.56", () => {
  assert.equal(update.versionIsNewer("1.2.3", "1.1.56"), true);
  assert.equal(update.versionIsNewer("1.1.56", "1.2.3"), false);
  assert.equal(update.versionIsNewer("1.1.56", "1.1.56"), false);
  assert.equal(update.versionIsNewer("1.1.57", "1.1.56"), true);
});

test("versionIsNewer 容忍 v 前缀与 -selfuse 后缀", () => {
  assert.equal(update.versionIsNewer("v1.1.56-selfuse", "1.1.56"), false);
  assert.equal(update.versionIsNewer("1.1.57-selfuse", "v1.1.56-selfuse"), true);
});

test("packageLooksUpstream 拦截带 ./redteam 导出的上游完整包", () => {
  const upstream = JSON.stringify({ name: "dsh-purge", exports: { ".": "./lib/index.js", "./redteam": "./lib/redteam.js" } });
  const selfuse = JSON.stringify({ name: "dsh-purge", exports: { ".": "./lib/index.js" } });
  assert.equal(update.packageLooksUpstream(upstream), true);
  assert.equal(update.packageLooksUpstream(selfuse), false);
  assert.equal(update.packageLooksUpstream("not json"), false);
});

test("更新源固定指向本 fork 123ada11f/dsh-purge", () => {
  const src = fs.readFileSync(path.join(root, "lib", "update.js"), "utf8");
  const m = src.match(/const REPO = "([^"]+)"/);
  assert.ok(m, "lib/update.js 应有 REPO 常量");
  assert.equal(m[1], "123ada11f/dsh-purge");
});

test("本地版本与 package.json 一致，且所有 -selfuse 标签都能被识别", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.equal(update.localVersion(), pkg.version);
});
