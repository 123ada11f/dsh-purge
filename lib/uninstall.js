import fs from "node:fs";
import { promises as fsp } from "node:fs";
import path from "node:path";
import * as core from "./core.js";
import * as hostctl from "./host.js";
import * as rules from "./rules.js";
import * as updater from "./update.js";

export function wasApplied(state) {
  if (!state) return false;
  if (state.has_backup) return true;
  if (Number(state.patches_applied) > 0) return true;
  return [state.shim_cmd, state.shim_ps1, state.shim_bin].includes("patched");
}

export function shouldDeletePluginTree(dir, dshHome = core.findDshHome()) {
  if (!dir) return false;
  let real;
  try {
    real = fs.realpathSync(dir);
  } catch {
    real = path.resolve(dir);
  }
  const n = real.replace(/[/\\]+/g, "/").toLowerCase();
  if (n.includes("/node_modules/dsh-purge")) return true;
  let home;
  try {
    home = fs.realpathSync(dshHome);
  } catch {
    home = path.resolve(dshHome);
  }
  const homeN = home.replace(/[/\\]+/g, "/").toLowerCase();
  return n.startsWith(`${homeN}/profiles/`);
}

function isPurgeBundleItem(item) {
  if (typeof item === "string") return item === "dsh-purge" || item.startsWith("dsh-purge@");
  const id = item && (item.id || item.name);
  return id === "dsh-purge";
}

function stripBundleList(list) {
  if (!Array.isArray(list)) return { list, changed: false };
  const next = list.filter((item) => !isPurgeBundleItem(item));
  return { list: next, changed: next.length !== list.length };
}

export function stripPluginFromPackage(pkg) {
  if (!pkg || typeof pkg !== "object") return false;
  let changed = false;
  for (const key of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
    if (pkg[key] && Object.prototype.hasOwnProperty.call(pkg[key], "dsh-purge")) {
      delete pkg[key]["dsh-purge"];
      changed = true;
    }
  }
  for (const key of ["bundles", "plugins"]) {
    const top = stripBundleList(pkg[key]);
    if (top.changed) {
      pkg[key] = top.list;
      changed = true;
    }
    const nested = pkg.dsh && pkg.dsh.profile ? pkg.dsh.profile[key] : null;
    const nest = stripBundleList(nested);
    if (nest.changed) {
      pkg.dsh.profile[key] = nest.list;
      changed = true;
    }
  }
  return changed;
}

function readJson(fp) {
  try {
    return JSON.parse(fs.readFileSync(fp, "utf8"));
  } catch {
    return null;
  }
}

function writeJson(fp, value) {
  fs.writeFileSync(fp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function pkgMentionsPurge(pkg) {
  if (!pkg) return false;
  if (pkg.dependencies?.["dsh-purge"] || pkg.devDependencies?.["dsh-purge"]) return true;
  for (const key of ["bundles", "plugins"]) {
    if (Array.isArray(pkg[key]) && pkg[key].some(isPurgeBundleItem)) return true;
    const nested = pkg.dsh && pkg.dsh.profile ? pkg.dsh.profile[key] : null;
    if (Array.isArray(nested) && nested.some(isPurgeBundleItem)) return true;
  }
  return false;
}

export function listInstalledProfiles(dshHome = core.findDshHome()) {
  const root = path.join(dshHome, "profiles");
  if (!fs.existsSync(root)) return [];
  let names = [];
  try {
    names = fs.readdirSync(root);
  } catch {
    return [];
  }
  const out = [];
  for (const name of names) {
    const dir = path.join(root, name);
    const pkgPath = path.join(dir, "package.json");
    const pkg = readJson(pkgPath);
    const nm = path.join(dir, "node_modules", "dsh-purge");
    if (!pkgMentionsPurge(pkg) && !fs.existsSync(nm)) continue;
    const spec = pkg?.dependencies?.["dsh-purge"] || pkg?.devDependencies?.["dsh-purge"] || "";
    out.push({ name, dir, spec: String(spec || ""), pkgPath, hasModule: fs.existsSync(nm) });
  }
  return out;
}

async function unlinkIfExists(fp) {
  try {
    await fsp.unlink(fp);
    return true;
  } catch (e) {
    if (e && e.code === "ENOENT") return false;
    throw e;
  }
}

async function rmIfExists(fp) {
  try {
    await fsp.rm(fp, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

async function removeOverride(dshHome) {
  const fp = core.findOverrideFile(dshHome);
  const ok = await unlinkIfExists(fp);
  return { path: fp, removed: ok };
}

async function resetRules(dshHome) {
  const reset = await rules.resetToOriginal(dshHome);
  const dir = rules.rulesDir(dshHome);
  const removedDir = await rmIfExists(dir);
  return { ...reset, rules_dir: dir, rules_dir_removed: removedDir };
}

function collectCleanupDirs(profiles, dshHome) {
  const seen = new Set();
  const cleanup = [];
  const remember = (dir) => {
    if (!dir) return;
    let real;
    try {
      real = fs.realpathSync(dir);
    } catch {
      real = path.resolve(dir);
    }
    const key = real.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    cleanup.push(real);
  };

  for (const p of profiles) {
    const nm = path.join(p.dir, "node_modules", "dsh-purge");
    if (!fs.existsSync(nm)) continue;
    let real;
    try {
      real = fs.realpathSync(nm);
    } catch {
      real = path.resolve(nm);
    }
    if (shouldDeletePluginTree(real, dshHome)) remember(real);
    if (path.resolve(nm).toLowerCase() !== real.toLowerCase()) remember(nm);
  }

  const dataDir = path.join(dshHome, "dsh-purge");
  remember(dataDir);

  const root = updater.pluginRoot();
  if (shouldDeletePluginTree(root, dshHome)) remember(root);

  return cleanup;
}

function unregisterProfiles(profiles) {
  const stripped = [];
  const errors = [];
  for (const p of profiles) {
    try {
      const pkg = readJson(p.pkgPath) || {};
      if (stripPluginFromPackage(pkg)) {
        writeJson(p.pkgPath, pkg);
        stripped.push(p.name);
      }
    } catch (e) {
      errors.push({ profile: p.name, error: String(e && e.message ? e.message : e) });
    }
  }
  return { stripped, errors };
}

export async function uninstallPurge() {
  const state = await core.gatherState();
  const applied = wasApplied(state);
  const dshHome = state.dsh_home || core.findDshHome();
  const report = {
    ok: true,
    applied,
    reverted: false,
    needRestart: true,
    patches: null,
    shim: null,
    flash: null,
    override: null,
    rules: null,
    profiles: [],
    cleanup: [],
    errors: [],
  };

  const fatal = (msg) => {
    report.errors.push(msg);
    report.ok = false;
    report.needRestart = false;
    report.cleanup = [];
  };

  try {
    // 与 applyPatchesAllHosts 对称：apply 打全部宿主，卸载也还原全部宿主。
    // 只对单宿主 revert 会让其他宿主保持补丁态，而共享数据目录已被清理。
    const all = await core.revertAllHosts();
    report.patches = all;
    if (applied && (all.reverted?.length || all.errors?.length)) report.reverted = true;
    for (const [p, e] of all.errors || []) fatal(`revert patches ${p}: ${e}`);
  } catch (e) {
    fatal(`revert patches: ${e.message || e}`);
  }
  if (!report.ok) return report;

  try {
    report.shim = await core.revertAllShims();
    if (state.shim_cmd === "patched" || state.shim_ps1 === "patched" || state.shim_bin === "patched") {
      report.reverted = true;
    }
    // revertShim 把逐文件失败编码为 `error:...` 返回值而不抛出，必须显式扫。
    for (const [dir, files] of Object.entries(report.shim || {})) {
      if (dir === "_desktop_scrub") continue;
      for (const [fname, st] of Object.entries(files || {})) {
        if (typeof st === "string" && st.startsWith("error:")) fatal(`revert shim ${dir}/${fname}: ${st}`);
      }
    }
  } catch (e) {
    fatal(`revert shims: ${e.message || e}`);
  }

  try {
    report.flash = core.revertCmdFlash(state.ai_base, dshHome);
  } catch (e) {
    fatal(`revert flash: ${e.message || e}`);
  }

  try {
    report.override = await removeOverride(dshHome);
  } catch (e) {
    fatal(`remove override: ${e.message || e}`);
  }

  try {
    report.rules = await resetRules(dshHome);
  } catch (e) {
    fatal(`reset rules: ${e.message || e}`);
  }
  // 任一关键回滚失败都禁止清理：cleanup 会删掉备份与数据目录，失败时必须保留。
  if (!report.ok) return report;

  const profiles = listInstalledProfiles(dshHome);
  report.profiles = profiles.map((p) => p.name);
  const unreg = unregisterProfiles(profiles);
  report.stripped = unreg.stripped;
  report.errors.push(...unreg.errors.map((x) => `${x.profile}: ${x.error}`));
  if (unreg.errors.length) {
    report.ok = false;
    report.needRestart = false;
    report.cleanup = [];
    return report;
  }

  report.cleanup = collectCleanupDirs(profiles, dshHome);
  return report;
}

export function scheduleCleanupRestart(opts = {}) {
  hostctl.scheduleCleanupRestart(opts);
}
