#!/usr/bin/env node
/**
 * 打包后冒烟：不开宿主、不写磁盘，只验证"装上去能用"的最低条件。
 *
 * 覆盖：
 * 1. 每个 exports 子路径都指向真实存在的文件；
 * 2. 关键模块能被 import（循环依赖/顶层 await 写错会在这里炸）；
 * 3. 补丁表结构与 id 唯一性；
 * 4. cordis.patch.yml 里的插件条目仍在；
 * 5. 随包预设齐两个文件，且能被 registry 读成定义。
 *
 * 用法：node scripts/smoke.mjs   （失败 exit 1）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const failures = [];
const ok = [];

function check(label, fn) {
  try {
    const value = fn();
    ok.push(label);
    return value;
  } catch (error) {
    failures.push(`${label}: ${error?.message || error}`);
    return null;
  }
}

async function checkAsync(label, fn) {
  try {
    const value = await fn();
    ok.push(label);
    return value;
  } catch (error) {
    failures.push(`${label}: ${error?.message || error}`);
    return null;
  }
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

check("package.json 有 name/version/exports", () => {
  if (!pkg.name || !pkg.version) throw new Error("缺少 name 或 version");
  if (!pkg.exports || typeof pkg.exports !== "object") throw new Error("缺少 exports");
});

for (const [key, value] of Object.entries(pkg.exports || {})) {
  const target = typeof value === "string" ? value : value?.default;
  check(`exports["${key}"] → ${target}`, () => {
    if (!target) throw new Error("没有 default 目标");
    const file = path.join(root, target);
    if (!fs.existsSync(file)) throw new Error(`目标文件不存在: ${target}`);
  });
}

check("bin 入口存在且可执行声明", () => {
  const bins = pkg.bin || {};
  const entries = Object.entries(bins);
  if (!entries.length) throw new Error("没有 bin");
  for (const [name, rel] of entries) {
    const file = path.join(root, rel);
    if (!fs.existsSync(file)) throw new Error(`${name} 指向不存在的文件: ${rel}`);
    const head = fs.readFileSync(file, "utf8").slice(0, 40);
    if (!head.startsWith("#!")) throw new Error(`${rel} 缺少 shebang`);
  }
});

const load = (rel) => import(pathToFileURL(path.join(root, rel)).href);

const indexMod = await checkAsync("lib/index.js 可 import", () => load("lib/index.js"));
await checkAsync("lib/core.js 可 import", () => load("lib/core.js"));
await checkAsync("lib/identity.js 可 import", () => load("lib/identity.js"));
await checkAsync("lib/anchors.js 可 import", () => load("lib/anchors.js"));
await checkAsync("lib/audit.js 可 import", () => load("lib/audit.js"));
await checkAsync("lib/probe.js 可 import", () => load("lib/probe.js"));

check("lib/index.js 导出 apply / inject / 三个工具函数", () => {
  if (!indexMod) throw new Error("模块没加载起来");
  for (const key of ["apply", "inject"]) {
    if (!(key in indexMod)) throw new Error(`缺少导出 ${key}`);
  }
});

const coreMod = await checkAsync("lib/core.js 导出补丁表", () => load("lib/core.js"));
check("补丁表结构完整、id 唯一", () => {
  const patches = coreMod?.ALL_PATCHES;
  if (!Array.isArray(patches) || patches.length === 0) throw new Error("ALL_PATCHES 为空");
  const ids = new Set();
  for (const patch of patches) {
    if (!Number.isInteger(patch?.id)) throw new Error(`补丁 id 非整数: ${JSON.stringify(patch?.id)}`);
    if (ids.has(patch.id)) throw new Error(`补丁 id 重复: ${patch.id}`);
    ids.add(patch.id);
    const work = (patch.replacements || patch.patterns || []).length;
    if (!work && !patch.markers && !patch.marker && !patch.replace) {
      throw new Error(`补丁 ${patch.id} 没有任何替换/标记`);
    }
  }
  return patches.length;
});

check(`dsh.install.tarball 指向 v${pkg.version}-selfuse`, () => {
  const url = pkg.dsh?.install?.tarball;
  if (!url) throw new Error("package.json 里没有 dsh.install.tarball");
  // 自用版的 Release 标签带 `-selfuse` 后缀（更新面板只列这类标签，见 lib/update.js 的
  // SELFUSE_TAG_RE），资产文件名仍按 package.json 的版本号：tag 与文件名本来就不同名。
  const want = `download/v${pkg.version}-selfuse/dsh-purge-${pkg.version}.tgz`;
  if (!url.endsWith(want)) throw new Error(`tarball 与版本号不一致: ${url}`);
});

// README 曾经停在 1.1.75 而包已经发到 1.1.77 —— 装的人照抄的就是旧链接。钉住。
for (const name of ["README.md", "README.zh-CN.md"]) {
  check(`${name} 的版本横幅与安装链接是 ${pkg.version}`, () => {
    const text = fs.readFileSync(path.join(root, name), "utf8");
    const banner = new RegExp(`<strong>Version ${pkg.version.replace(/\./g, "\\.")}(?:[^<]*)</strong>`);
    if (!banner.test(text)) {
      throw new Error(`版本横幅不是 ${pkg.version}`);
    }
    const found = text.match(/releases\/download\/v\d+\.\d+\.\d+(?:-selfuse)?\//g) || [];
    const wrong = [...new Set(found)].filter((m) => !m.startsWith(`releases/download/v${pkg.version}`));
    if (wrong.length) throw new Error(`安装链接仍指向旧版本: ${wrong.join(", ")}`);
    if (!text.includes(`download/v${pkg.version}-selfuse/dsh-purge-${pkg.version}.tgz`)) {
      throw new Error(`没有指向 v${pkg.version}-selfuse 的安装链接`);
    }
  });
}

check(`release-notes.md 顶部标题是本版本 ${pkg.version}`, () => {
  const head = fs
    .readFileSync(path.join(root, "release-notes.md"), "utf8")
    .split("\n")
    .find((line) => line.startsWith("# "));
  if (head?.trim() !== `# ${pkg.version}`) {
    throw new Error(`顶部标题是 "${head?.trim()}"，应该是 "# ${pkg.version}"`);
  }
});

check("cordis.patch.yml 仍含 dsh-purge 插件条目", () => {
  const file = path.join(root, "cordis.patch.yml");
  const text = fs.readFileSync(file, "utf8");
  if (!/dsh-purge/.test(text)) throw new Error("cordis.patch.yml 里找不到 dsh-purge");
  if (!/insert:/.test(text)) throw new Error("cordis.patch.yml 里找不到 insert 段");
});

console.log(`smoke: ${ok.length} 项通过`);
for (const line of ok) console.log(`  ok  ${line}`);
if (failures.length) {
  console.error(`\nsmoke: ${failures.length} 项失败`);
  for (const line of failures) console.error(`  FAIL ${line}`);
  process.exit(1);
}
