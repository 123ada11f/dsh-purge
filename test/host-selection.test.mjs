import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-purge-hosts-"));
process.env.DSH_HOME = path.join(tmpRoot, "dsh-home");

function makeAiBase(name, { version = "1.2.3", appPackage = null } = {}) {
  const aiBase = path.join(tmpRoot, name, "resources", "app", "node_modules", "@deepseek-ai");
  fs.mkdirSync(path.join(aiBase, "dsh-agent-instructions", "lib"), { recursive: true });
  fs.writeFileSync(path.join(aiBase, "dsh-agent-instructions", "lib", "index.js"), "ORIGINAL_MARKER;\n");
  fs.mkdirSync(path.join(aiBase, "dsh-base"), { recursive: true });
  fs.writeFileSync(
    path.join(aiBase, "dsh-base", "package.json"),
    JSON.stringify({ name: "@deepseek-ai/dsh-base", version }),
  );
  if (appPackage) {
    fs.writeFileSync(path.join(tmpRoot, name, "resources", "app", "package.json"), JSON.stringify(appPackage));
  }
  return aiBase;
}

const selectedHost = makeAiBase("fixture-web");
const pideckHost = makeAiBase("PiDeck", {
  // 版本以宿主应用清单为准；dsh-base 自己的包版本不能盖住 PiDeck 版本。
  version: "1.1.56",
  appPackage: { name: "pideck-app", productName: "PiDeck", version: "0.2.0-rc.2" },
});
process.env.DSH_BASE = pideckHost;

const core = await import("../lib/core.js");

test("--host 支持空格与等号两种形式，并验证绝对有效 aiBase", () => {
  assert.equal(core.explicitHostFromArgs(["--status", "--host", selectedHost]), path.normalize(selectedHost));
  assert.equal(core.explicitHostFromArgs([`--status`, `--host=${selectedHost}`]), path.normalize(selectedHost));
  assert.throws(() => core.explicitHostFromArgs(["--status", "--host", "relative/path"]), /--host 必须是绝对路径/);
  assert.throws(() => core.explicitHostFromArgs(["--status", "--host="]), /--host 需要一个绝对路径/);
  const missing = path.join(tmpRoot, "missing-host");
  assert.throws(() => core.explicitHostFromArgs(["--status", "--host", missing]), /--host 路径不存在或不是目录/);
  const invalid = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-purge-not-base-"));
  assert.throws(() => core.explicitHostFromArgs(["--status", "--host", invalid]), /不是有效的 aiBase/);
  assert.throws(
    () => core.explicitHostFromArgs(["--status", "--host", selectedHost, `--host=${pideckHost}`]),
    /--host 只能指定一次/,
  );
});

test("宿主身份不混：Web/CLI、npx 与 PiDeck 0.2.0-rc.2 分别标注", () => {
  const npxHost = makeAiBase(path.join("_npx", "fixture", "node_modules", "@deepseek-ai"));
  assert.equal(core.describePatchHost(selectedHost).kind, "web");
  assert.equal(core.describePatchHost(npxHost).kind, "npx");
  const pideck = core.describePatchHost(pideckHost);
  assert.equal(pideck.kind, "pideck");
  assert.equal(pideck.version, "0.2.0-rc.2");
});

test("listKnownPiDeckAiBases：只枚举 APPDATA/PiDeck/runtimes 下的合法 aiBase", () => {
  const appData = path.join(tmpRoot, "known-appdata");
  const pideckBase = path.join(
    appData,
    "PiDeck",
    "runtimes",
    "dsh",
    "0.2.0-rc.2",
    "node_modules",
    "@deepseek-ai",
  );
  fs.mkdirSync(path.join(pideckBase, "dsh-agent-instructions", "lib"), { recursive: true });
  fs.writeFileSync(path.join(pideckBase, "dsh-agent-instructions", "lib", "index.js"), "ORIGINAL_MARKER;\n");
  const oldAppData = process.env.APPDATA;
  process.env.APPDATA = appData;
  try {
    const list = core.listKnownPiDeckAiBases();
    assert.equal(list.length, 1);
    assert.equal(path.normalize(list[0]), path.normalize(pideckBase));
    process.env.APPDATA = path.join(tmpRoot, "empty-appdata");
    assert.equal(core.listKnownPiDeckAiBases().length, 0);
  } finally {
    process.env.APPDATA = oldAppData;
  }
});

test("status 默认快速模式仍标出选中宿主、候选与 PiDeck 警告；--discover 才全量", async () => {
  const state = await core.gatherState({ aiBase: selectedHost });
  assert.equal(path.normalize(state.ai_base), path.normalize(selectedHost));
  assert.equal(state.selected_host.kind, "web");
  assert.equal(state.host_candidate_discovery, "fast");
  const selected = state.host_candidates.find((host) => host.selected);
  assert.equal(path.normalize(selected.aiBase), path.normalize(selectedHost));
  assert.ok(state.host_candidates.some((host) => host.kind === "pideck" && host.version === "0.2.0-rc.2"));
  assert.ok(state.host_warnings.some((warning) => warning.includes("PiDeck 0.2.0-rc.2")));

  const text = core.hostStatusLines(state).join("\n");
  assert.match(text, /本次选中宿主 Web\/CLI 1\.2\.3/);
  assert.match(text, /其它候选宿主/);
  assert.match(text, /快速探测；--discover 完整枚举/);
  assert.match(text, /PiDeck 0\.2\.0-rc\.2/);
  assert.match(text, /插件链与 dsh-purge 不兼容/);

  const fullState = await core.gatherState({ aiBase: selectedHost, hostDiscover: true });
  assert.equal(fullState.host_candidate_discovery, "full");
  assert.ok(fullState.host_candidates.some((host) => host.selected));
  assert.match(core.hostStatusLines(fullState).join("\n"), /完整枚举/);
});

test("Apply/Revert 的宿主集合尊重 --host，只写指定夹具", async () => {
  const explicit = makeAiBase("apply-target");
  const other = makeAiBase("apply-other");
  process.env.DSH_BASE = other;
  const fixturePatch = {
    id: 990,
    name: "host selection fixture",
    layer: "test",
    layer_en: "test",
    file: "agent-instructions",
    markers: ["PATCHED_MARKER"],
    patterns: ["ORIGINAL_MARKER"],
    replace: "PATCHED_MARKER // dsh-purge host-selection",
  };

  const result = await core.applyPatchesAllHosts([fixturePatch], {
    aiBase: explicit,
    discover: true,
    preserveClientBundles: true,
  });
  assert.deepEqual(result.hosts.map((host) => path.normalize(host.aiBase)), [path.normalize(explicit)]);
  const explicitFile = path.join(explicit, "dsh-agent-instructions", "lib", "index.js");
  const otherFile = path.join(other, "dsh-agent-instructions", "lib", "index.js");
  assert.match(fs.readFileSync(explicitFile, "utf8"), /PATCHED_MARKER/);
  assert.match(fs.readFileSync(otherFile, "utf8"), /ORIGINAL_MARKER/);
  assert.equal(fs.existsSync(`${otherFile}.dshpurge.bak`), false);

  await core.revertAllHosts({ aiBase: explicit });
  assert.match(fs.readFileSync(explicitFile, "utf8"), /ORIGINAL_MARKER/);
  assert.match(fs.readFileSync(otherFile, "utf8"), /ORIGINAL_MARKER/);
});
