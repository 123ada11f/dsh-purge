#!/usr/bin/env node
/**
 * _purge-text-worker.mjs
 * 由 purge-git-secrets.mjs 调用，不单独使用。
 * 四种运行方式：
 *   1) git filter-branch --tree-filter "node _purge-text-worker.mjs"
 *      在当前检出目录里就地替换（env: PURGE_MAP / PURGE_LOG）
 *   2) node _purge-text-worker.mjs --worktree <dir>
 *      对普通工作区做就地替换
 *   3) node _purge-text-worker.mjs --scan <dir>
 *      只报告会改哪些文件，不写盘
 *   4) node _purge-text-worker.mjs --filter-stdin
 *      读 stdin 写 stdout（给 filter-branch --msg-filter 用）
 */
import fs from 'node:fs';
import path from 'node:path';

const mapFile = process.env.PURGE_MAP;
if (!mapFile) {
  console.error('[purge-worker] 缺少 PURGE_MAP');
  process.exit(2);
}

const cfg = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
const logFile = process.env.PURGE_LOG || '';

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const rules = [];
for (const r of cfg.replace || []) {
  if (!r || typeof r.find !== 'string' || !r.find) continue;
  const re = r.regex ? new RegExp(r.find, r.flags || 'g') : new RegExp(escapeRe(r.find), 'g');
  rules.push({ re, with: String(r.with ?? ''), label: r.label || r.find });
}
for (const p of cfg.patterns || []) {
  if (!p || p.enabled === false || !p.regex) continue;
  rules.push({ re: new RegExp(p.regex, p.flags || 'g'), with: String(p.with ?? ''), label: p.label || p.regex });
}

const SKIP_DIRS = new Set(['.git', 'node_modules', '.cache', '.next', 'dist', 'build']);
const MAX_BYTES = 32 * 1024 * 1024;

let seen = 0;
let changed = 0;
let hits = 0;
const log = [];

function isBinary(buf) {
  const n = Math.min(buf.length, 8192);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

function scrubText(text) {
  let out = text;
  let n = 0;
  for (const r of rules) {
    out = out.replace(r.re, () => {
      n += 1;
      return r.with;
    });
  }
  return { out, n };
}

function visit(dir, write) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (ent.isSymbolicLink()) continue;
    const full = dir === '.' ? ent.name : path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (SKIP_DIRS.has(ent.name)) continue;
      visit(full, write);
      continue;
    }
    if (!ent.isFile()) continue;

    let stat;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (stat.size === 0 || stat.size > MAX_BYTES) continue;

    seen += 1;
    let buf;
    try {
      buf = fs.readFileSync(full);
    } catch {
      continue;
    }
    if (isBinary(buf)) continue;

    const text = buf.toString('utf8');
    if (text.includes('\uFFFD')) {
      // 非 UTF-8 文本（GBK 等）不做替换，避免破坏文件
      continue;
    }
    const { out, n } = scrubText(text);
    if (n === 0 || out === text) continue;

    changed += 1;
    hits += n;
    log.push(`${full}\t${n}`);
    if (write) {
      try {
        fs.writeFileSync(full, out, 'utf8');
      } catch (err) {
        console.error(`[purge-worker] 写入失败 ${full}: ${err.message}`);
        process.exitCode = 1;
      }
    }
  }
}

const argv = process.argv.slice(2);

if (argv.includes('--filter-stdin')) {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  const { out } = scrubText(Buffer.concat(chunks).toString('utf8'));
  process.stdout.write(out);
  process.exit(0);
}

const modeIdx = argv.findIndex((a) => a === '--worktree' || a === '--scan');
if (modeIdx >= 0) {
  const mode = argv[modeIdx];
  const target = argv[modeIdx + 1] || '.';
  process.chdir(path.resolve(target));
  visit('.', mode === '--worktree');
  if (logFile && log.length && mode === '--worktree') {
    try {
      fs.appendFileSync(logFile, log.join('\n') + '\n', 'utf8');
    } catch {
      /* 日志失败不影响清洗 */
    }
  }
  if (mode === '--scan') {
    process.stdout.write(log.join('\n') + (log.length ? '\n' : ''));
    process.stderr.write(`[purge-worker] 扫描文件 ${seen}，命中文件 ${changed}，命中次数 ${hits}\n`);
  } else {
    console.log(`[purge-worker] 文件 ${seen}，改写 ${changed}，替换 ${hits}`);
  }
  process.exit(process.exitCode || 0);
}

visit('.', true);
if (logFile && log.length) {
  try {
    fs.appendFileSync(logFile, log.join('\n') + '\n', 'utf8');
  } catch {
    /* 忽略 */
  }
}
process.exit(process.exitCode || 0);
