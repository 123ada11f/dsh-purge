# 维护工具 / Maintenance tools

这些脚本用于**适配 dsh 新版本**时定位「哪个补丁的锚点断了」，不参与插件运行期，也不被 `package.json` 引用。
全部为 ESM 单文件、无依赖、只读原树（`preview.mjs` 也只写到你指定的 `outDir`，永不写目标安装树）。

```powershell
# 环境变量（缺省时按 .dsh 相对路径找，建议显式给出）
$env:DSH_HOME = "$env:USERPROFILE\.dsh"
$AI = "$env:APPDATA\DSH\data\versions\0.2.1-rc.2\node_modules\@deepseek-ai"   # 要检查的安装树
```

| 脚本 | 用途 |
| --- | --- |
| `diag.mjs <pluginRoot> <aiBase> [dshHome] [--json out] [--show-ok] [--bak]` | **逐补丁干跑**：在目标树上模拟应用，输出每个补丁 `pending / applied / unmatched / pattern_not_found / missing_file / na`。`pending` 在未打补丁的树上是好状态（说明锚点还在）。含 `--bak` 可从 `.dshpurge.bak` 还原出的原文上判定。 |
| `status-raw.mjs <pluginRoot> <aiBase> [dshHome]` | 直接调用插件自己的 `patchStatus()`，出状态统计（最接近插件面板看到的数字）。 |
| `preview.mjs <pluginRoot> <aiBase> <outDir> [ids...]` | 不写目标树：把「改后 / 改前」两份文件落到 `outDir`（`<key>__<pkg>.js` 与 `.orig.js`），用于人工 diff 与 `node --check`。 |
| `perrep.mjs <pluginRoot> <aiBase> <ids...>` | **逐 replacement 命中报告**：定位是补丁里的哪一条锚点断了。 |
| `probe.mjs <pluginRoot> <aiBase021> <aiBase020> <dshHome> <ids> <outFile>` | 打印补丁的 pattern/replace，并在目标原文里定位近似锚点区段（±400/1400 字符），用于写新锚点。 |
| `sim.mjs <pluginRoot> <aiBase> [dshHome] [--json out]` | **顺序干跑**：按 `ALL_PATCHES` 顺序在内存里逐个应用，能正确判断链式补丁（如 `#87` → `#88`），避免单补丁干跑把链式补丁误报为断锚。 |
| `cmp.mjs <jsonA> <jsonB>` | 对比两份 `diag` 结果，列出「A 上能打、B 上打不动」的差异清单。 |
| `patchset-diff.mjs <rootA> <rootB>` | 逐 replacement 比对两张补丁表（本仓库 vs 其它 fork），输出只有差别的补丁 id。 |
| `dump-patches.mjs <pluginRoot> <outFile>` | 导出全部补丁定义为 JSON（`RegExp` → `{__re, flags}`），便于外部脚本分析。 |
| `pdiff.mjs <fileA> <fileB>` | 两份文件的紧凑 diff（预览产物对比用）。 |
| `cwd-check.mjs <pluginRoot> <aiBase021>` | **提示词变量回归**：用宿主真实的 `renderPrompt` + 插件的 `rewritePromptAssembly` 验证「改写后的 assembly 不含未注册变量」。第一条用例复现 0.2.1 上 `{{cwd}}` 导致 `unknown prompt variable` 的致命链，其余覆盖 `personaSuffix` 为空 / 用户正文里的 `{{cwd}}` / 无 session 头 / 0.2.0（`variables.cwd` 存在）/ `cwd` 变量补注册。改动 `lib/identity.js`、`cordis.patch.yml` 的 persona 段后**必跑**。 |

## 典型流程（上游发新版时）

1. 装一份出厂态的新版本树到别处（不要动正在用的安装树）：

   ```powershell
   npm install --prefix work\ai<version> --no-audit --no-fund @deepseek-ai/dsh@<version>
   # aiBase = work\ai<version>\node_modules\@deepseek-ai
   ```

2. `node tools/status-raw.mjs <repo> <aiBase>` → 找出 `skipped` / `pattern_not_found` 的补丁。
3. `node tools/perrep.mjs <repo> <aiBase> <断锚的 id...>` → 定位是哪条 replacement 断的。
4. `node tools/probe.mjs ...` 看新原文，补 pattern（提示词类文件优先；`lib/harness-dev-context` 这类搬家的包要同时加进 `targetFiles()`）。
5. `node tools/preview.mjs <repo> <aiBase> work\preview` → diff + `node --check` 校验产物语法。
6. 真实应用：`$env:DSH_BASE=<aiBase>; $env:DSH_SURFACE=web; node bin/dsh-purge.js --apply`，再跑一遍 `preview.mjs` 确认幂等（0 改动）。
7. `node tools/cwd-check.mjs <repo> <aiBase>` → 确认提示词变量仍能全部解析（宿主每升级一次就可能删掉变量，见 `docs/MIGRATION-0.2.1.md` 第 8 节）。

## A/B 复现「提示词变量致命」故障（真机端到端）

`tools/ab/` 下有两个叠加层，用宿主自己跑一轮命令验证 `{{cwd}}` 这条致命链（本机已实测）：

```powershell
$bin = '<0.2.1>\node_modules\@deepseek-ai\dsh\lib\bin.js'
node $bin --profile headless --patch tools\ab\ov-cwd-bad.yml  "reply exactly: OK"
#   → dsh: UNKNOWN: unknown prompt variable "{{cwd}}" in section "deployment:persona-suffix";
#          registered variables: provider, model        ← 用户看到的「任何对话都无法回复」
node $bin --profile headless --patch tools\ab\ov-cwd-good.yml "reply exactly: OK"
#   → 不再报变量错，直接推进到下一阶段（本机无 key 时是 MISSING_CREDENTIAL）→ 装配已通过
```

`--patch` 叠加层在 profile 层之后应用，因此也可以用来验证「宿主新版本又删掉了某个变量」这类回归。

## 关于冻结文案

`dsh-harness-dev-context` 里的 `LEGACY_*` 常量是历史会话使用的冻结文案（参与旧会话的 prompt-version 比对），
**任何补丁都不要改它**。同一个句子在现役模板与冻结常量里可能各出现一次，写 pattern 时必须锚定收尾字符
（现役模板以反引号结束，冻结常量以双引号结束）或加负向先行断言，否则会误改冻结文案、导致旧会话提示词被重写。
