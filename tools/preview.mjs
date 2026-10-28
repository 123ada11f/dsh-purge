// 在内存中按 ALL_PATCHES 顺序对指定 aiBase 做全量应用，并把结果写盘到 outDir（只预览，不动原树）。
// 用法: node tools/preview.mjs <pluginRoot> <aiBase> <outDir> [ids...]
import fs from 'node:fs';
import path from 'node:path';

const [pluginRoot, aiBase, outDir, ...idArgs] = process.argv.slice(2);
const only = idArgs.length ? new Set(idArgs.map(Number)) : null;
process.env.DSH_HOME = process.env.DSH_HOME || (process.env.DSH_HOME || ".dsh");
process.env.DSH_SURFACE = process.env.DSH_SURFACE || 'web';

const core = await import(new URL('file:///' + path.join(pluginRoot, 'lib', 'core.js').replace(/\\/g, '/')).href);
const asLf = (t) => t.replace(/\r\n/g, '\n');

// --- 与 core.js 内联判定（core.js 未导出 patchApplied，逐字复刻，勿独立演化） ---
function patchApplied(text, patch) {
  const hay = asLf(text);
  if (Array.isArray(patch?.forbid) && patch.forbid.some((m) => hay.includes(asLf(m)))) return false;
  if (Array.isArray(patch.markers) && patch.markers.length > 0) {
    const match = patch.markersAny ? 'some' : 'every';
    return patch.markers[match]((m) => hay.includes(asLf(m)));
  }
  if (patch.marker) return hay.includes(asLf(patch.marker));
  if (typeof patch.replace === 'string' && patch.replace.length > 0) {
    return hay.includes(asLf(patch.replace).split('\n')[0].slice(0, 60));
  }
  return false;
}
const files = core.targetFiles(aiBase);

// key -> 文件路径清单（只保留真实存在的）
const map = new Map();
for (const [key, raw] of Object.entries(files)) {
  const fps = (Array.isArray(raw) ? raw : [raw]).filter((f) => f && fs.existsSync(f));
  if (fps.length) map.set(key, fps);
}

const before = new Map();
for (const [key, fps] of map) for (const fp of fps) before.set(fp, fs.readFileSync(fp, 'utf8'));
console.log('[preview] map keys=' + map.size + ' buffers=' + before.size);

const touched = new Set();
for (const p of core.ALL_PATCHES) {
  if (only && !only.has(p.id)) continue;
  if (!core.patchAppliesHere(p)) continue;
  const keys = Array.isArray(p.file) ? p.file : [p.file];
  for (const key of keys) {
    for (const fp of map.get(key) ?? []) {
      const src = before.get(fp);
      if (typeof src !== 'string') continue;
      let dst = src;
      if (p.skipIfMarked && patchApplied(src, p)) continue;
      const res = core.applyReplacementsToText(src, p, fp);
      dst = typeof res === 'string' ? res : res.text;
      if (dst !== src) { before.set(fp, dst); touched.add(fp); }
    }
  }
}

fs.mkdirSync(outDir, { recursive: true });
const rows = [];
for (const [key, fps] of map) {
  for (const fp of fps) {
    const rel = path.relative(aiBase, fp);
    const after = before.get(fp);
    const orig = fs.readFileSync(fp, 'utf8');
    if (after === orig) continue;
    const dest = path.join(outDir, key + '__' + path.basename(path.dirname(fp)) + '.js');
    fs.writeFileSync(dest, after, 'utf8');
    const origDest = dest.replace(/__([^_]+)\.js$/, '__$1.orig.js');
    fs.writeFileSync(origDest, orig, 'utf8');
    const changed = after.split('\n').filter((l, i) => l !== orig.split('\n')[i]).length;
    rows.push({ key, file: rel, out: dest, orig: origDest, approxChanged: changed });
  }
}
console.log('changed files: ' + rows.length);
for (const r of rows) console.log(' - ' + r.key.padEnd(22) + ' ' + r.file + '  lines-diff~' + r.approxChanged);
console.log('outDir = ' + path.resolve(outDir));
