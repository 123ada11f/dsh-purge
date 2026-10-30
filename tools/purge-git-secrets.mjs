#!/usr/bin/env node
/**
 * purge-git-secrets.mjs — 把 secrets.map.json 里的字符串/正则从 git 全历史
 * （所有 commit、所有分支、所有 tag）和当前工作区彻底清除，并做验证、备份与收尾。
 *
 * 用法：
 *   node tools/purge-git-secrets.mjs --dry-run        # 只报会改哪些提交与文件
 *   node tools/purge-git-secrets.mjs                  # 真跑（默认自动 bundle 备份）
 *   node tools/purge-git-secrets.mjs --verify-only    # 只查历史里还有没有残留
 *   node tools/purge-git-secrets.mjs --worktree-only  # 只清工作区，不动历史
 *   node tools/purge-git-secrets.mjs --history-only   # 只清历史，不动工作区
 *   node tools/purge-git-secrets.mjs --messages       # 连提交信息一起清
 *   node tools/purge-git-secrets.mjs --map <file>     # 换替换表
 *   node tools/purge-git-secrets.mjs --keep-original  # 保留 refs/original（回滚用）
 *
 * 全程只用 git 自带能力（filter-branch + plumbing），不依赖 git-filter-repo。
 * 子进程输出一律走临时文件重定向，不用管道，因此在本机沙箱里也能跑。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORKER = path.join(HERE, '_purge-text-worker.mjs');
const DEFAULT_MAP = path.join(HERE, 'secrets.map.json');

const HELP = `purge-git-secrets — git 全历史秘密清洗

  node tools/purge-git-secrets.mjs [选项]

  --dry-run          只报告，不写盘
  --verify-only      只验证历史是否还有残留（退出码 1 表示有残留）
  --worktree-only    只清工作区
  --history-only     只清历史
  --messages         连提交信息一起清（默认只报警告）
  --map <file>       替换表，默认 tools/secrets.map.json
  --repo <dir>       仓库路径，默认当前目录
  --no-backup        不生成 bundle 备份（不建议）
  --keep-original    保留 refs/original
  --no-aggressive    gc 不用 --aggressive
  --yes              跳过交互确认
  -h, --help         显示本帮助
`;

function parseArgs(argv) {
  const a = {
    repo: process.cwd(),
    map: DEFAULT_MAP,
    dryRun: false,
    verifyOnly: false,
    worktreeOnly: false,
    historyOnly: false,
    messages: false,
    backup: true,
    keepOriginal: false,
    aggressive: true,
    yes: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const v = argv[i];
    if (v === '--dry-run') a.dryRun = true;
    else if (v === '--verify-only') a.verifyOnly = true;
    else if (v === '--worktree-only') a.worktreeOnly = true;
    else if (v === '--history-only') a.historyOnly = true;
    else if (v === '--messages') a.messages = true;
    else if (v === '--no-backup') a.backup = false;
    else if (v === '--keep-original') a.keepOriginal = true;
    else if (v === '--no-aggressive') a.aggressive = false;
    else if (v === '--yes' || v === '-y') a.yes = true;
    else if (v === '-h' || v === '--help') a.help = true;
    else if (v === '--map') a.map = path.resolve(argv[++i] || '');
    else if (v === '--repo') a.repo = path.resolve(argv[++i] || '');
    else throw new Error(`未知参数：${v}`);
  }
  return a;
}

const A = parseArgs(process.argv.slice(2));
if (A.help) {
  console.log(HELP);
  process.exit(0);
}

// ---------------------------------------------------------------- 进程工具

function tmpFile(tag) {
  return path.join(
    os.tmpdir(),
    `purge-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}-${tag}`,
  );
}

/** 跑 git 并捕获 stdout（经临时文件，不用管道） */
function gitOut(repo, args, env) {
  const f = tmpFile('out');
  const fd = fs.openSync(f, 'w');
  const r = spawnSync('git', args, {
    cwd: repo,
    stdio: ['ignore', fd, 'inherit'],
    windowsHide: true,
    env: { ...process.env, ...(env || {}) },
  });
  fs.closeSync(fd);
  const text = fs.readFileSync(f, 'utf8');
  fs.unlinkSync(f);
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失败（exit ${r.status}）`);
  return text;
}

/** 跑 git 并捕获二进制 stdout */
function gitBinary(repo, args) {
  const f = tmpFile('bin');
  const fd = fs.openSync(f, 'w');
  const r = spawnSync('git', args, { cwd: repo, stdio: ['ignore', fd, 'inherit'], windowsHide: true });
  fs.closeSync(fd);
  const buf = fs.readFileSync(f);
  fs.unlinkSync(f);
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失败（exit ${r.status}）`);
  return buf;
}

/** 跑 git 并把输出直接打到终端 */
function gitRun(repo, args, env) {
  const r = spawnSync('git', args, {
    cwd: repo,
    stdio: 'inherit',
    windowsHide: true,
    env: { ...process.env, ...(env || {}) },
  });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失败（exit ${r.status}）`);
}

const shq = (p) => `"${p.replace(/\\/g, '/').replace(/"/g, '\\"')}"`;

// ---------------------------------------------------------------- 替换规则

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function buildRules(cfg) {
  const rules = [];
  for (const r of cfg.replace || []) {
    if (!r || typeof r.find !== 'string' || !r.find) continue;
    rules.push({
      re: r.regex ? new RegExp(r.find, r.flags || 'g') : new RegExp(escapeRe(r.find), 'g'),
      with: String(r.with ?? ''),
      label: r.label || r.find,
      global: r.regex ? (r.flags || 'g').includes('g') : true,
    });
  }
  for (const p of cfg.patterns || []) {
    if (!p || p.enabled === false || !p.regex) continue;
    rules.push({
      re: new RegExp(p.regex, p.flags || 'g'),
      with: String(p.with ?? ''),
      label: p.label || p.regex,
      global: (p.flags || 'g').includes('g'),
    });
  }
  if (!rules.length) throw new Error('替换表里没有任何规则');
  return rules;
}

function isBinary(buf) {
  const n = Math.min(buf.length, 8192);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

function scanText(text, rules) {
  const hits = [];
  for (const r of rules) {
    r.re.lastIndex = 0;
    let m;
    while ((m = r.re.exec(text))) {
      hits.push({ rule: r.label, text: m[0] });
      if (!r.global) break;
      if (m[0] === '') r.re.lastIndex += 1;
    }
  }
  return hits;
}

// ---------------------------------------------------------------- 历史遍历

function listRevs(repo) {
  return gitOut(repo, ['rev-list', '--all']).split('\n').map((s) => s.trim()).filter(Boolean);
}

function listBlobs(repo, revs) {
  const blobs = new Map();
  for (const rev of revs) {
    const out = gitOut(repo, ['ls-tree', '-r', '-z', rev]);
    for (const rec of out.split('\0')) {
      if (!rec) continue;
      const m = /^(\d+) (\w+) ([0-9a-f]+)\t([\s\S]*)$/.exec(rec);
      if (m && m[2] === 'blob') blobs.set(m[3], m[4]);
    }
  }
  return blobs;
}

function scanBlobs(repo, rules, blobs) {
  const hits = [];
  for (const [sha, file] of blobs) {
    const buf = gitBinary(repo, ['cat-file', '-p', sha]);
    if (isBinary(buf)) continue;
    const text = buf.toString('utf8');
    if (text.includes('\uFFFD')) continue;
    for (const h of scanText(text, rules)) hits.push({ sha, file, ...h });
  }
  return hits;
}

function scanMessages(repo, rules) {
  const log = gitOut(repo, ['log', '--all', '--format=%H%x1f%B%x1e']);
  const hits = [];
  for (const block of log.split('\x1e')) {
    const idx = block.indexOf('\x1f');
    if (idx < 0) continue;
    const sha = block.slice(0, idx).trim();
    const body = block.slice(idx + 1);
    for (const h of scanText(body, rules)) hits.push({ sha, rule: h.rule, text: h.text });
  }
  return hits;
}

// ---------------------------------------------------------------- 备份

function makeBackup(repo) {
  const dir = path.join(repo, '.git', 'purge-backup');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const bundle = path.join(dir, `pre-purge-${stamp}.bundle`);
  gitRun(repo, ['bundle', 'create', bundle, '--all']);
  const refs = gitOut(repo, ['for-each-ref', '--format=%(refname) %(objectname)']);
  fs.writeFileSync(path.join(dir, `refs-${stamp}.txt`), refs, 'utf8');
  return { bundle, dir, stamp };
}

// ---------------------------------------------------------------- 工作区

function worktreeScan(repo, mapPath) {
  const f = tmpFile('scan');
  const fd = fs.openSync(f, 'w');
  spawnSync(process.execPath, [WORKER, '--scan', repo], {
    cwd: repo,
    stdio: ['ignore', fd, 'inherit'],
    windowsHide: true,
    env: { ...process.env, PURGE_MAP: mapPath },
  });
  fs.closeSync(fd);
  const text = fs.readFileSync(f, 'utf8');
  fs.unlinkSync(f);
  return text.split('\n').filter(Boolean).map((line) => {
    const [file, n] = line.split('\t');
    return { file, hits: Number(n) || 0 };
  });
}

function worktreeScrub(repo, mapPath) {
  spawnSync(process.execPath, [WORKER, '--worktree', repo], {
    cwd: repo,
    stdio: 'inherit',
    windowsHide: true,
    env: { ...process.env, PURGE_MAP: mapPath },
  });
}

// ---------------------------------------------------------------- 主流程

function main() {
  const repo = gitOut(path.resolve(A.repo), ['rev-parse', '--show-toplevel']).trim();
  if (!repo) throw new Error('当前目录不在 git 仓库里');
  process.chdir(repo);

  if (!fs.existsSync(A.map)) throw new Error(`替换表不存在：${A.map}`);
  const cfg = JSON.parse(fs.readFileSync(A.map, 'utf8'));
  const rules = buildRules(cfg);

  const headBefore = gitOut(repo, ['rev-parse', 'HEAD']).trim();

  if (A.verifyOnly) {
    const revs = listRevs(repo);
    const blobs = listBlobs(repo, revs);
    const hits = scanBlobs(repo, rules, blobs);
    const msgHits = scanMessages(repo, rules);
    console.log(`提交 ${revs.length} 个，blob ${blobs.size} 个`);
    console.log(`历史残留：${hits.length} 处${hits.length ? '' : '（干净）'}`);
    for (const h of hits.slice(0, 30)) console.log(`  ${h.sha.slice(0, 8)} ${h.file}  [${h.rule}] ${h.text.slice(0, 24)}`);
    if (hits.length > 30) console.log(`  …还有 ${hits.length - 30} 处`);
    if (msgHits.length) console.log(`提交信息残留：${msgHits.length} 处（加 --messages 一起清）`);
    process.exit(hits.length ? 1 : 0);
  }

  const revs = listRevs(repo);
  const blobs = listBlobs(repo, revs);
  const hits = scanBlobs(repo, rules, blobs);
  const msgHits = scanMessages(repo, rules);
  const plannedFiles = [...new Set(hits.map((h) => h.file))];

  console.log(`仓库：${repo}`);
  console.log(`提交 ${revs.length} 个（HEAD ${headBefore.slice(0, 8)}），blob ${blobs.size} 个，规则 ${rules.length} 条`);
  console.log(`历史命中：${hits.length} 处，涉及 ${plannedFiles.length} 个路径`);
  for (const p of plannedFiles.slice(0, 20)) console.log(`  - ${p}`);
  if (plannedFiles.length > 20) console.log(`  …还有 ${plannedFiles.length - 20} 个`);
  if (msgHits.length) {
    console.log(`提交信息命中：${msgHits.length} 处${A.messages ? '（本次一并重写）' : '（未重写，加 --messages）'}`);
  }

  if (A.dryRun) {
    if (!A.historyOnly) {
      const wt = worktreeScan(repo, A.map);
      const total = wt.reduce((s, x) => s + x.hits, 0);
      console.log(`工作区命中：${total} 处，涉及 ${wt.length} 个文件`);
      for (const w of wt.slice(0, 20)) console.log(`  - ${w.file}（${w.hits}）`);
      if (wt.length > 20) console.log(`  …还有 ${wt.length - 20} 个`);
    }
    if (!hits.length && !msgHits.length) console.log('\n历史已干净，无需重写。');
    console.log('\n--dry-run：没有写任何东西。');
    return;
  }

  const status = gitOut(repo, ['status', '--porcelain']).trim();
  if (status && !A.historyOnly && !A.worktreeOnly) {
    console.log('\n工作区有未提交改动，先 commit 或 stash 再跑（或加 --worktree-only）。');
    console.log(status.split('\n').slice(0, 10).join('\n'));
    process.exit(1);
  }

  let backup = null;
  if (!A.worktreeOnly && A.backup) {
    backup = makeBackup(repo);
    console.log(`\n已备份：${path.relative(repo, backup.bundle)}`);
  }

  if (!A.worktreeOnly && hits.length) {
    console.log('\n重写历史（filter-branch，temp 树逐提交替换）…');
    const logPath = path.join(repo, '.git', 'purge-backup', `worker-${Date.now()}.tsv`);
    fs.mkdirSync(path.dirname(logPath), { recursive: true });

    const tf = `node ${shq(WORKER)}`;
    const args = ['filter-branch', '-f', '--tree-filter', tf, '--tag-name-filter', 'cat'];
    if (A.messages && msgHits.length) {
      args.push('--msg-filter', `node ${shq(WORKER)} --filter-stdin`);
    }
    args.push('--', '--all');

    gitRun(repo, args, {
      FILTER_BRANCH_SQUELCH_WARNING: '1',
      PURGE_MAP: A.map,
      PURGE_LOG: logPath,
    });

    if (!A.keepOriginal) {
      fs.rmSync(path.join(repo, '.git', 'refs', 'original'), { recursive: true, force: true });
    }
    gitRun(repo, ['reflog', 'expire', '--expire=now', '--all']);
    gitRun(repo, A.aggressive ? ['gc', '--prune=now', '--aggressive'] : ['gc', '--prune=now']);
  } else if (!A.worktreeOnly) {
    console.log('\n历史已干净，跳过重写。');
  }

  if (!A.historyOnly) {
    console.log('\n清理工作区…');
    worktreeScrub(repo, A.map);
  }

  // 复验
  const revs2 = listRevs(repo);
  const blobs2 = listBlobs(repo, revs2);
  const rest = scanBlobs(repo, rules, blobs2);
  const restMsg = scanMessages(repo, rules);
  const headAfter = gitOut(repo, ['rev-parse', 'HEAD']).trim();

  const report = {
    repo,
    at: new Date().toISOString(),
    headBefore,
    headAfter,
    commits: revs.length,
    blobs: blobs.size,
    historyHitsBefore: hits.length,
    messageHitsBefore: msgHits.length,
    residual: rest.length,
    residualMessages: restMsg.length,
    backup: backup ? backup.bundle : null,
  };
  const reportPath = path.join(repo, '.git', 'purge-backup', `report-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');

  console.log('');
  if (rest.length) {
    console.log(`复验失败：历史里仍有 ${rest.length} 处残留`);
    for (const h of rest.slice(0, 10)) console.log(`  ${h.sha.slice(0, 8)} ${h.file} [${h.rule}]`);
    console.log(`报告：${path.relative(repo, reportPath)}`);
    process.exit(1);
  }
  if (restMsg.length && !A.messages) {
    console.log(`注意：提交信息里还有 ${restMsg.length} 处（加 --messages 再跑一次）`);
  }

  console.log('清洗完成');
  console.log(`  HEAD ${headBefore.slice(0, 8)} → ${headAfter.slice(0, 8)}`);
  console.log(`  重写 ${revs.length} 个提交，清除历史命中 ${hits.length} 处`);
  console.log(`  复验：历史残留 0 处`);
  if (backup) console.log(`  备份：${path.relative(repo, backup.bundle)}`);
  console.log(`  报告：${path.relative(repo, reportPath)}`);
  console.log('');
  console.log('下一步：');
  console.log('  git push --force --all');
  console.log('  git push --force --tags');
  console.log('  # 旧对象仍可能被 GitHub 缓存/被 fork 保留：仓库设置里清缓存，必要时提工单；');
  console.log('  # 泄露的是密钥就立刻吊销重发，历史清洗不等于止损。');
  if (backup) {
    console.log('');
    console.log(`回滚：git fetch ${shq(backup.bundle)} 'refs/*:refs/restore/*' 后按 refs-*.txt 指回`);
  }
}

try {
  main();
} catch (err) {
  console.error(`\n[purge] 失败：${err && err.message ? err.message : err}`);
  process.exit(1);
}
