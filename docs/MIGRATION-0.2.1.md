# dsh-purge 维护分支：迁移到 dsh 0.2.1-rc.2

本仓库是 `dsh-purge` 的**本地维护分支**。上游 `YuJunZhiXue/dsh-purge` 已停止维护，
最后一个版本是 **1.1.71**（`dshTarget: "0.2.0-rc.2"`，commit `6c1d638d1bdcc45ede50fc30249c753d58122a51`）。
本分支在 1.1.71 的全量源码上做少量适配，使其在 **dsh 0.2.1-rc.2** 上同样可用，
同时保持对 0.2.0-rc.2 的向后兼容。

- 版本：`1.1.73`
- `dshTarget`：`0.2.1-rc.2`
- 基线 commit：`61811c5`（= 上游 master，与安装版逐字节一致）
- 迁移 commit：见 `git log`

---

## 1. dsh 0.2.1-rc.2 相对 0.2.0-rc.2 的结构变化（本次适配的依据）

1. **Web 面身份提示词搬家**：0.2.0 里 Web 面提示词在 `dsh-web-app/lib/index.js`；
   0.2.1 移到新包 **`dsh-harness-dev-context/lib/index.js`**，并且 URL 不再由 `${webUrl}`
   插值，而是由 runtime context 提供：

   - `const WEB_SURFACE_PROMPT = \`You are interacting with the user through the DeepSeek Harness Web GUI whose URL the runtime context names. ... Do not start a replacement server unless the user asks; if one is needed, use a managed background job and verify its exact URL.\``
   - `const HARNESS_SOURCE_PROMPT = \`The runtime context names the DeepSeek Harness implementation checkout. ...\``
   - 运行时值：`Current DeepSeek Harness implementation checkout: ...`、`Current DeepSeek Harness Web GUI URL: ...`
   - 同文件内的 `LEGACY_SOURCE` / `LEGACY_WEB_SURFACE` 是**冻结的历史文案**（源码注释明确
     说明改动它们会让历史会话的 prompt-version 匹配失效、触发已记录提示词重写）→
     **补丁刻意不碰这两块**，只改 `WEB_SURFACE_PROMPT` / `HARNESS_SOURCE_PROMPT` 与运行时值。

2. **`system-prompt` 的 assemble 收尾新增 `requiredContexts` 过滤**，`contexts` 的收尾语义随之改变：

   ```js
   const transformed = await this.ctx.waterfall(scopeTarget(this, scope), "system-prompt/assemble", assembly, context, () => Promise.resolve(assembly));
   if (completeSection === void 0 && !runtimeContextSuppressed) return transformed;
   const requiredContexts = new Set([...contextByName.values()].filter((entry) => entry.required === true).map((entry) => entry.name));
   return {
   	...transformed,
   	sections: completeSection === void 0 ? transformed.sections : [completeSection],
   	contexts: runtimeContextSuppressed ? transformed.contexts.filter((entry) => requiredContexts.has(entry.name)) : transformed.contexts
   };
   ```

3. **rewind（回退）特性被上游移除**：0.2.1 全树几乎不再出现 `rewind`，
   `dsh-client-ui-conversation` 里 0.2.0 原生的 `isRewindMarker` / `rewindVisibleEntries`
   已不存在。
4. **包集合变化**：0.2.1 删除了 `dsh-hooks-claude-code` / `dsh-hooks-codex` /
   `dsh-hook-protocol` / `dsh-invariants` / `dsh-client-runtime` / `dsh-client-ui-slots` 等；
   新增 `dsh-harness-dev-context` / `dsh-tool-terminal` / `dsh-working-directory` 等。
5. 0.2.1 的安装树**没有** `dsh/node_modules/@deepseek-ai` 嵌套层，
   `system-prompt-nested` / `tool-web-nested` / `hooks-*-nested` 等键自动不登记（正常）。

---

## 2. 本次改动清单（`lib/core.js`）

新增文件键：

```js
"dev-context": allExisting([
  ...nestedPkg(aiBase, "dsh-harness-dev-context", "lib", "index.js"),
  ...(root ? [path.join(root, "packages", "context", "harness-dev-context", "lib", "index.js")] : []),
]),
```

| 补丁 | 改动 |
| --- | --- |
| `#25 HARNESS_IDENTITY_STRIP` | `file` → `["system-prompt", "dev-context"]`；新增 2 条替换：`The runtime context names the DeepSeek Harness implementation checkout.` → `...the harness implementation checkout. // [dsh-purge] identity stripped`；运行时值 `Current DeepSeek Harness implementation checkout: ` → `Current harness implementation checkout: ` |
| `#32 WEB_SURFACE_IDENTITY_NEUTRAL` | `file` → `["web-app-lib", "dev-context"]`；新增 3 条替换（dev-context 身份句 → local web GUI；`Advertised URL of the DeepSeek Harness Web GUI serving this session.` → `Advertised URL of the web GUI serving this session.`；运行时值 `Current DeepSeek Harness Web GUI URL: ` → `Current web GUI URL: `）；新 marker `through the local web GUI whose URL the runtime context names.` |
| `#53 WEB_SURFACE_PROHIBITION` | `file` → `["web-app-lib", "dev-context"]`；新增 pattern：`You are interacting with the user through the local web GUI whose URL the runtime context names.` → `Local web GUI URL: named by the runtime context. // [dsh-purge] web surface identity neutralized`；删句 `Do not start a replacement server ...` 同时覆盖 dev-context |
| `#40 COMPLETE_PROMPT_KEEP_INJECT` | 新增常量 `COMPLETE_PROMPT_WATERFALL_INJECT_021`（0.2.1 版 complete 改写块，**保留 `requiredContexts` 两行与 `contexts: ... filter(...)` 语义**），并追加 2 条 replacement（缩进不敏感正则 + tab 逐字版）指向该常量 |
| `package.json` | `version` 1.1.71 → 1.1.73；`dshTarget` `0.2.0-rc.2` → `0.2.1-rc.2` |

设计要点（为什么这样做）：

- `#40` 断掉的根因是 0.2.1 在 `return` 前多插了 `requiredContexts` 并改了 `contexts` 收尾语义。
  改写块必须**保留**该语义，否则 complete 模式下官方 required 上下文会被丢掉 —— 所以新增
  独立常量而不是复用 0.2.0 版块。
- `#32` / `#53` 断掉的根因是提示词换了包、换了措辞。因此给这两个补丁补上 `dev-context`
  文件键 + 新措辞 pattern，旧 pattern 原样保留（继续支持 0.2.0）。
- `#53` 的删句在 0.2.0 是一个普通字符串 pattern，在 0.2.1 的 dev-context 里该句会与
  `LEGACY_WEB_SURFACE` 的冻结 `suffix` 同时命中，因此 dev-context 用「带反引号+分号的整句」
  作 pattern，只删当前文案、不动冻结文案。

---

## 3. 验证方法与结果

对 0.2.1-rc.2 干净安装树（`%APPDATA%\DSH\data\versions\0.2.1-rc.2\node_modules\@deepseek-ai`）：

1. **离线顺序干跑**（在内存里按 `ALL_PATCHES` 顺序模拟，不写盘）：
   改前 `pending=59 / skipped=6`；改后 `pending=62 / applied=5 / na=11 / missing_file=1 / skipped=3`。
2. **预览**（渲染每个目标文件的最终内容并做 `node --check`）：41 个 JS 全部语法通过；
   改后只剩 `dev-context` 的预期 4 行差异。
3. **真实应用**：`node bin/dsh-purge.js --apply`（`DSH_BASE` 指向 0.2.1 安装树）→
   **71/83 已清洗，0 待清洗**（`applied=71 / na=11 / missing_file=1`，11+1 里只有 `#71` 是真缺文件）。
   注：补丁表此后又加了 `#89` / `#90`，当前总数见 `core.ALL_PATCHES.length`。
4. **幂等性**：对已清洗的树再跑一次预览 → `changed files: 0`。
5. **启动自检**：`node <0.2.1>/@deepseek-ai/dsh/lib/bin.js --version` → `0.2.1-rc.2`（exit 0）；
   `dsh web --port 50399 --no-open` 成功起服务，页面里注册了
   `{"id":"dsh-purge","url":"plugins/??dsh-purge/client.js&rev=..."}`，`client.js` 取回 200 / 457 KB。
6. **0.2.0 无回归**：同样的补丁集对已清洗的 0.2.0 安装树仍是 `applied=71 / na=7 / missing_file=1 / skipped=1 / pending=2`，与迁移前逐项一致。

### 在 0.2.1 上不适用（非回归）的补丁

| 补丁 | 状态 | 原因 |
| --- | --- | --- |
| `#77 REWIND_DROP_SENT_ON_APPEND` | applied（1.1.73 起） | 0.2.1 的 `append()` 改成按需清空 `revised`，补上该锚点后回退功能恢复 |
| `#80 MINIMAL_OFFICIAL_TOOLSET` | applied（1.1.73 起） | 撤销型补丁：出厂宿主本来就没有插件加过的工具，标 `softSettle` 后不再报「跳过」 |
| `#64` `#65 HOOKS_*` | na | 0.2.1 不再有 `dsh-hooks-*` 包 |
| `#71 LIANGSHEN_IDENTITY_LINE` / `#76 PRESET_UNRESTRICTED_*` | missing_file / na | 本机未安装对应预设包，0.2.0 上情况相同 |
| `#45` `#46` `#82` `#83` `#84` | na | desktop 面补丁，web 面不适用 |

---

## 4. 安装 / 回滚 / 维护

安装（把 profile 的依赖指向本仓库）：

```powershell
# %DSH_HOME%\profiles\web\package.json 里把 dsh-purge 的依赖改为本地仓库
#   "dsh-purge": "file:C:/Users/83079/Documents/TEST/dsh-purge"
# （pnpm 的 link: 会建 junction，宿主解析不到 @deepseek-ai/* bare import；file: 才会装进 .pnpm 目录并正常解析）
# 然后在 profile 目录里安装：
cd $env:USERPROFILE\.dsh\profiles\web
pnpm install
```

手动清洗 / 查看状态：

```powershell
cd <repo>
$env:DSH_BASE = "$env:APPDATA\DSH\data\versions\0.2.1-rc.2\node_modules\@deepseek-ai"
node bin/dsh-purge.js --status     # 逐补丁状态
node bin/dsh-purge.js --apply      # 应用全部补丁
node bin/dsh-purge.js --revert     # 从备份还原
```

维护提示：

- 适配 dsh 新版本时，先跑 `--status` 找出 `skipped` 的补丁，再用 `--dump`/源码对比确认锚点新写法。
- `#32` / `#53` / `#25` 的锚点都在提示词文件里，上游每次改文案都需要补 pattern。
- 冻结的历史文案（`LEGACY_*`）永远不要动。

---

## 5. 1.1.73：收尾两条「状态刷红」的补丁

1.1.72 之后，与另一个独立适配 0.2.1 的社区 fork 做了逐条交叉对比
（`kingcharleslzy-ai/dsh-purge` 1.3.3，详见 [COMPARE-community-1.3.3.md](./COMPARE-community-1.3.3.md)），
据此补掉两个只剩「状态不好看」的补丁：

| 补丁 | 改动 | 理由 |
| --- | --- | --- |
| `#77 REWIND_DROP_SENT_ON_APPEND` | 新增 0.2.1 锚点：`if (this.revised.size > 0) this.revised.clear();` | 0.2.1 把无条件清空改成按需清空；补上该锚点后，`isRewindMarker` 分支在 `append()` 里重新生效，回退（rewind）功能在 0.2.1 上恢复 |
| `#80 MINIMAL_OFFICIAL_TOOLSET` | 标 `softSettle: true` | 撤销型补丁：出厂宿主本来就没有插件追加过的 `tool-fs` / `tool-web`，此时「没东西可撤」就是目标状态，不该长期显示「跳过」 |

应用后 live `0.2.1-rc.2` 树的状态：`applied=70  na=11  missing_file=1`、**0 pending**，
其中 `missing_file` 只有 `#71`（本机未装 liangshen 预设包，0.2.0 上同样如此）。
`#88` 属链式补丁（锚在 `#87` 自己写出的代码上），出厂态干跑会显示 `skipped`，真实应用后为 `applied`——属误报，非缺陷。

## 6. 诊断工具（本仓库 `tools/`，不在插件运行期使用）

| 工具 | 用途 |
| --- | --- |
| `tools/diag.mjs <pluginRoot> <aiBase> [dshHome] [--json out]` | 逐补丁干跑，判定每个补丁在目标树上能否落锚（复刻 `core.js` 的判定逻辑） |
| `tools/status-raw.mjs <pluginRoot> <aiBase> <dshHome>` | 直接用插件自己的 `patchStatus()` 出状态统计 |
| `tools/preview.mjs <pluginRoot> <aiBase> <outDir> [ids]` | 不写原树，把「改后/改前」两份产到 `outDir`，用于人工 diff 与 `node --check` |
| `tools/patchset-diff.mjs <rootA> <rootB>` | 逐 replacement 比对两张补丁表的差异 |
| `tools/perrep.mjs <pluginRoot> <aiBase> <ids...>` | 逐 replacement 命中报告（定位是哪一条锚点断了） |
| `tools/probe.mjs` / `tools/cmp.mjs` / `tools/dump-patches.mjs` | 锚点区段打印 / 两份 diag 结果对比 / 导出补丁定义 |

## 7. 1.1.74：修 upstream issue #121（队列 steer 静默失效）

上游 [issue #121](https://github.com/YuJunZhiXue/dsh-purge/issues/121) 报的是真实缺陷，不是迁移副作用，`1.1.71` 起一直存在（在途事件 `agents running` 时按 `Ctrl+Enter`「插话发送」无任何反应，消息停在队列，界面无 toast、无报错）。

**根因（两条改动只改了一半）**

- `#86` 第 1 条把 `@deepseek-ai/dsh-api-session-controller/lib/index.js` 的队列分支改成 `agent.followup(message)`（= `send(msg, "next-turn")`），于是「插话」退化成「排队」；
- 但同文件上方守卫仍要求该 item 在 `next-turn` 列表且 `agent.status === "running"`，前端 `steerQueue()` 也从 `next-turn` 取件，两边语义错位时还会落到 `session/steer-unavailable`；
- 该错误码又被前端静默吞掉（`dsh-client-ui-conversation/lib/client.js`：`if (result.error.code === "session/steer-unavailable" || ... === "session/queue-item-not-found") return;`），所以「什么都没有发生」；
- `dsh-agent-loop` 侧 `steer()` 早已收回 `next-step`（`#86` 第 2/3 条），只有 session-controller 这一处没跟。

**修法（新增补丁 `#90 SESSION_QUEUE_STEER_KEEP_MIDTURN`，`optional: true`）**

把队列 `steer` 分支收回 `agent.steer(message)`（= `send(msg, "next-step")`，重新注入当前轮），与公共 `steer()` 和官方 0.2.1 语义一致。两条 replacement：

1. `agent.followup(message); // [dsh-purge-86] queue steer → next-turn` → `agent.steer(message); // [dsh-purge-90] queue steer injects mid-turn (issue #121)`
   —— 修已经被 `#86` 打过的树（含 `1.1.71` 及本 fork `1.1.73` 的全部历史安装）。
2. 出厂原文 `agent.steer(message);` → 同上加 `#90` 标记 —— `#86` 被停用/未打过时也能自洽。

`#90` 排在 `ALL_PATCHES` 末位（id 最大），保证在 `#86` 之后执行；`PATCH_DISPLAY_GROUPS.followup` 已扩成 `[85, 86, 90]`，清洗页仍折叠成一行。标记是 `[dsh-purge-90] queue steer injects mid-turn`。

**验证**

```sh
node tools/perrep.mjs <pluginRoot> <aiBase> 90      # 已打过 #86 的树上，第 1 条应为 MATCH
cd <pluginRoot> && node bin/dsh-purge.js --apply    # 落盘
node tools/diag.mjs <pluginRoot> <aiBase> <dshHome> # #90 由 pending 变 applied，pending 仍为 0
```

**残留（有意不改）**：`session/steer-unavailable` 仍被前端静默吞掉——那是「turn 刚好结束」的正常竞态，消息仍在队列里，按 `Enter` 即可发；改它要动前端 bundle 语义，超出本次维护范围。

---

## 8. 1.1.75：修 0.2.1 上「任何对话都无法回复」（`{{cwd}}` 不再是宿主变量）

**症状**：在 dsh `0.2.1-rc.2` 上，任何一轮对话都在发出请求前失败，GUI 报：

```
处理失败 · 本轮运行失败  unknown prompt variable "{{cwd}}" in section "deployment:persona-suffix"; registered variables: provider, model
```

**根因（上游行为变化 + 本插件自带模板的组合）**

- `dsh 0.2.0` 的 agent loop 注册三个提示词变量：`ctx.systemPrompt.variable("provider"|"model"|"cwd", ...)`（`dsh-agent-loop/lib/index.js:1580-1582`）；
- `dsh 0.2.1` **只注册 `provider` 和 `model`**（`dsh-agent-loop/lib/index.js:1607-1608`），`{{cwd}}` 被移除。`dsh-system-prompt/README.md` 明确写：模板不得依赖内建 `{{cwd}}`，未解析的引用会在任何模型请求之前让提示词组装失败；
- 本插件的 bundle patch 把 `personaSuffix` 设成 `Your working directory is {{cwd}}.`，而且 `lib/identity.js` 的改写链路还会主动写这个模板（`CWD_ONLY_SUFFIX`，以及把官方身份句折叠成 `Working directory: {{cwd}}.`），所以升级到 0.2.1 后**每一次**组装都带着未注册变量；
- 宿主插值器在 `rewritePromptAssembly` 之后运行（`dsh-system-prompt/lib/index.js:398` 的 waterfall → 之后 `renderPrompt`），所以报错点落在我们写出的 `deployment:persona-suffix` 段上。

**修法（三层，任一层都能挡住这个致命链）**

1. `cordis.patch.yml`：`personaSuffix` 置空（附注释说明为什么不能留变量）。0.2.1 里工作目录由 `dsh-working-directory` 以 `Current working directory: "<path>"` 形式进**用户上下文**，信息不丢。
2. `lib/identity.js`：新增 `cwdFromContext` / `cwdForAssembly` / `resolveCwdRefs` / `resolveCwdRefsInSections`，并在 `rewritePromptAssembly` 返回前对**所有**段落做最后一道 `{{cwd}}` 字面量化（session 头 → 宿主已注册的 `variables.cwd`（0.2.0）→ 进程 cwd）。改写链路里任何一处写模板都不会再漏出去。
3. `lib/index.js`：新增 `installCwdVariableCompat(ctx)`（在 `applyHostHooks` 与 `prepareAssemble` 各挂一次），给宿主补注册同名 `cwd` 变量——**用户自己**从 0.2.0 带过来的提示词/预设/规则里若还写着 `{{cwd}}`，也能继续解析。0.2.0 上宿主已注册同名变量，重复注册会抛 `prompt variable "cwd" is already registered`，按「已注册」吞掉，不改变旧行为。

**验证（两边真实代码：被测插件 + 宿主真插值器）**

```sh
node tools/cwd-check.mjs <pluginRoot> <aiBase021>
# PASS  复现：出厂 0.2.1 下模板 {{cwd}} 让插值抛错
# PASS  修复：personaSuffix 仍是模板时改写后不再抛
# PASS  新配置：personaSuffix 为空时仍渲染出工作目录行
# PASS  用户提示词里的 {{cwd}} 一并解析
# PASS  无 session 头时降级为描述而非留变量
# PASS  0.2.0 形态：variables.cwd 存在时按变量值解析
# PASS  变量补注册：注册成功且重复注册不抛
# cwd-check: 7/7 通过
```

测试里第一条用宿主真实的 `renderPrompt` 复现了原报错（`unknown prompt variable`），后面几条证明改写后的 assembly 不再含未注册变量、且工作目录行仍在。

**升级提醒**：`1.1.74` 及更早版本在 `0.2.1` 上会 100% 触发本故障（0.2.0 上正常）。凡是升到 `0.2.1` 的用户都必须装 `1.1.75` 或更新版本。
