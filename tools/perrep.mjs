import path from 'node:path';
import fs from 'node:fs';

const pluginRoot = process.argv[2];
const aiBase = process.argv[3];
const ids = process.argv.slice(4).map(Number);
process.env.DSH_HOME = process.env.DSH_HOME || (process.env.DSH_HOME || ".dsh");
process.env.DSH_SURFACE = process.env.DSH_SURFACE || 'web';

const core = await import(new URL('file:///' + path.join(pluginRoot, 'lib', 'core.js').replace(/\\/g, '/')).href);
const files = core.targetFiles(aiBase);
const asLf = (t) => t.replace(/\r\n/g, '\n');

for (const p of core.ALL_PATCHES) {
  if (!ids.includes(p.id)) continue;
  const keys = Array.isArray(p.file) ? p.file : [p.file];
  console.log(`#${p.id} ${p.name}  optional=${!!p.optional}`);
  for (const key of keys) {
    const raw = files[key];
    const fps = (Array.isArray(raw) ? raw : [raw]).filter((f) => f && fs.existsSync(f));
    if (!fps.length) { console.log(`  key=${key} :: NO FILE`); continue; }
    for (const fp of fps) {
      const text = asLf(fs.readFileSync(fp, 'utf8'));
      console.log(`  key=${key} fp=${path.relative(aiBase, fp)}`);
      const reps = core.ALL_PATCHES.find((x) => x.id === p.id).replacements ?? [];
      reps.forEach((r, i) => {
        const pat = r.pattern;
        let hit = false;
        if (pat instanceof RegExp) hit = new RegExp(pat.source, pat.flags.replace('g', '')).test(text);
        else hit = text.includes(asLf(pat));
        if (hit) console.log(`    [${i}] MATCH   ${String(pat).replace(/\n/g, '\\n').slice(0, 110)}`);
        else console.log(`    [${i}] nomatch ${String(pat).replace(/\n/g, '\\n').slice(0, 110)}`);
      });
    }
  }
}
