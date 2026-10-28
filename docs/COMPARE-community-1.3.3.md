# 与社区 fork 的对比：`kingcharleslzy-ai/dsh-purge` v1.3.3

本页记录 2026-10 两项独立 0.2.1 适配工作的交叉验证结果：本仓库（`dsh-purge` 1.1.73，只做迁移、保持 drop-in）
与社区 fork（`dsh-purge-community` 1.3.3，迁移 + 面板/诊断/自检等增量功能）。

- 参考仓库：https://github.com/kingcharleslzy-ai/dsh-purge
- 参考发布：https://github.com/kingcharleslzy-ai/dsh-purge/releases/tag/v1.3.3
- 素材：release 资产 `dsh-purge-community-1.3.3.tgz`（另从 `codeload` 取源码包 `src-v1.3.3.tar.gz`，1809701 B）
- 对方 `package.json`：`name: dsh-purge-community`、`version: 1.3.3`、`dshTarget: 0.2.1-rc.1`、83 条补丁
- 本仓库 `package.json`：`name: dsh-purge`、`version: 1.1.73`、`dshTarget: 0.2.1-rc.2`、82 条补丁

两者同一个上游（`YuJunZhiXue/dsh-purge`），补丁 id 体系一致（82 → 对方 83），因此可以逐条比对。

---

## 1. 交叉验证：同一棵干净 0.2.1-rc.2 树上的表现

干净树的来源（不是拷贝、不是回滚，而是重新装一份出厂态）：

```powershell
npm install --prefix work\ai021clean --no-audit --no-fund @deepseek-ai/dsh@0.2.1-rc.2
# => node_modules\@deepseek-ai，305 个包，479.8 MB，0 处 dsh-purge 标记（已确认为出厂态）
```

两台独立引擎（各自用自己的 `patchStatus()`，不做任何复刻判定）在同一棵树上的结果：

| 指标 | 本 fork 1.1.73 | 社区 1.3.3 |
| --- | --- | --- |
| 补丁总数 | 82 | 83 |
| `pending`（锚点仍在，可直接应用） | 63 | 64 |
| `applied`（已是目标状态） | 6 | 5 |
| `na`（该面/该包不适用） | 11 | 11 |
| `missing_file` | 1（`#71`，本机未装 liangshen 预设包） | 1（`#71`，同因） |
| 仍需迁移的 `skipped` | 1（`#88`，链式补丁的干跑误报） | 2（`#88` + `#80`） |

结论：**两台独立分叉对 0.2.1 的判断一致**——0.2.1 上真正需要重做锚点的补丁，两边都指向同一批
（`#25` `#32` `#40` `#53` `#77` `#80`），`#71` 是环境缺包、非 0.2.1 回归。唯一实质差异是 `#80` 的状态呈现（见 2.4）。

命令（本仓库工具）：

```powershell
node tools/status-raw.mjs <pluginRoot> <aiBase> <dshHome>   # 用插件自己的 patchStatus
node tools/diag.mjs <pluginRoot> <aiBase> <dshHome> --json out.json
node tools/patchset-diff.mjs <rootA> <rootB>                 # 逐 replacement 比对两张补丁表
```

---

## 2. 逐条差异（只有 5 个 id：`#25` `#32` `#40` `#53` `#80`）

### 2.1 `#25 HARNESS_IDENTITY_STRIP`

| | 内容 |
| --- | --- |
| 对方 | `file: ["system-prompt"]`，3 条 replacements（与上游相同） |
| 本 fork | `file: ["system-prompt", "dev-context"]`，5 条 —— 多两条去掉 `HARNESS_SOURCE_PROMPT` 与两条 runtime context 值里的 `DeepSeek Harness` |

0.2.1 把带产品名的句子搬到了新包 `dsh-harness-dev-context`，只清 `system-prompt` 会漏掉这几处。
本 fork 保留更彻底的做法，未采纳对方的收缩版。

### 2.2 `#32 WEB_SURFACE_IDENTITY_NEUTRAL` / `#53 WEB_SURFACE_PROHIBITION`

- 两边都把 `dsh-harness-dev-context/lib/index.js` 加进了 `file` 列表（内部键名不同：对方 `harness-dev-context`、
  本 fork `dev-context`，只是 `targetFiles()` 的键，不影响命中结果），命中的是同一批 0.2.1 文案。
- `#32`：对方 4 条、本 fork 5 条 —— 本 fork 额外把 runtime context 值里的 `Current DeepSeek Harness Web GUI URL: ` 去品牌。
- `#53`：对方的 replacement 是干净句 `Local web GUI: its URL is named in the runtime context.`；
  本 fork 带 `// [dsh-purge] web surface identity neutralized` 标记（便于幂等识别与回滚追溯）。语义等价。

**双方独立踩到并规避了同一个陷阱（重要互证）**：`dsh-harness-dev-context/lib/index.js` 里
`Do not start a replacement server unless the user asks; if one is needed, use a managed background job and verify its exact URL.`
出现两次，一份是现役模板（以反引号收尾，**该删**），另一份是 `LEGACY_WEB_SURFACE.suffix` 的冻结历史文案
（以双引号收尾，上游注释说明动了会让旧会话的 prompt-version 匹配失效 → 重写已记录提示词，**不能动**）。

| | 排除冻结文案的写法 |
| --- | --- |
| 对方 | 负向先行断言：`/ Do not start a replacement server ... verify its exact URL\.(?!")/g` |
| 本 fork | 反引号 + 分号收尾锚点：`` /Do not start a replacement server ... verify its exact URL\.`;/ `` |

两种写法都正确（各自锚定现役模板的收尾字符）。这条是本次对比最有价值的收获：两个独立实现得出同一结论，
说明本 fork 的修复不是巧合。

### 2.3 `#40 COMPLETE_PROMPT_KEEP_INJECT`

- 对方 7 条 replacements、本 fork 8 条；条目拆分与措辞不同，**语义一致**：
  两者都针对 0.2.1 新增的 `const requiredContexts = new Set([...contextByName.values()]...)` 保留了
  `contexts: runtimeContextSuppressed ? transformed.contexts.filter((entry) => requiredContexts.has(entry.name)) : transformed.contexts`，
  非 complete 分支都保留 `[...dshPurgeSections, ...dshPurgeRest]`，complete 分支都把官方 base 段放最后。
- 即：两边都避免「complete 模式丢掉官方 required 上下文」这个坑。未采纳对方的条目排布（本 fork 已实测通过）。

### 2.4 `#80 MINIMAL_OFFICIAL_TOOLSET`（唯一实质行为差异）

| | 处理 |
| --- | --- |
| 对方 | `settleWhenAbsent: true` —— 只在预设文件**整个不存在**时才算「无事可做」 |
| 本 fork | `softSettle: true` —— 文件在、但插件没加过那些工具（出厂树）时也算「已到位」 |

实测：出厂树上本 fork 报 `applied`，对方仍报 `skipped`。两者目的相同（撤销型补丁在出厂树不该刷红），
本 fork 的呈现更干净；已确认无副作用（live 0.2.1 树重跑状态 = 0 pending）。

### 2.5 对方新增、本 fork 未采纳的 `#89 ASK_USER_NO_BLOCK`

```js
pattern: \t\t\tconst timeout = validateTimeout(args.timeout ?? defaultTimeout);
replace: \t\t\tconst timeout = 1; // [dsh-purge] ask_user_question never blocks a turn
```

让「模型反问」不再卡住回合（等待上限压到 1 秒，超时继续）。属功能增强、不是 0.2.1 迁移所需，
本 fork 保持「只做迁移」，需要时照上面三行自行加一条补丁即可。

---

## 3. 功能面差异（非迁移）

| 维度 | 本 fork 1.1.73 | 社区 1.3.3 |
| --- | --- | --- |
| 定位 | 只把原插件带到 0.2.1，保持 drop-in | 社区维护版，迁移 + 增量功能 |
| 包名 | `dsh-purge`（与已装插件同名，profile 依赖可直接指过来） | `dsh-purge-community`（与上游/本 fork 并存，但需改 profile bundle 名） |
| `dshTarget` | `0.2.1-rc.2`（本机实测版本） | `0.2.1-rc.1` |
| 额外内容 | 无 | 面板诊断端点、自检、破甲强化、备份保留策略、撤回清单、`#89` 等（见其 README） |
| 验证范围 | Windows / web profile，0.2.1-rc.2 上 70 applied / 0 pending | 自述在 0.2.1-rc.1 副本上 63 写入 / 6 已到位 |

---

## 4. 选用建议 / 互换方法

- **继续用本 fork（当前状态）**：profile 依赖已指向本地仓库

  ```jsonc
  // %DSH_HOME%\profiles\web\package.json
  "dsh-purge": "file:C:/Users\SAMPLE\Documents\TEST/dsh-purge"
  ```

  改完在 profile 目录 `pnpm install`（`link:` 会建 junction，宿主解析不到 `@deepseek-ai/*` bare import；
  `file:` 才会装进 `.pnpm` 并正常解析）。

- **换成社区版**：把上面依赖改成 release tgz（或本地 tgz 路径），同时把 `dsh.profile.bundles` 里的 bundle 名
  换成 `dsh-purge-community`，再用它的 CLI `--apply`。注意其 `dshTarget` 是 `0.2.1-rc.1`。

- **不要两个同时启用**：补丁 id 重叠、marker 文案不同（例如 `#53` 的替换句、`#32` 的注释标记），
  同一棵树上会互相认不出对方产物并重复改写。换用前先在目标树 `--revert`。

- 上游再改版本时，两边都要重新对齐锚点；本 fork 的流程与诊断工具见 [MIGRATION-0.2.1.md](./MIGRATION-0.2.1.md)。

---

## 5. 实测记录（本机，2026-10）

| 目标树 | 引擎 | 结果 |
| --- | --- | --- |
| 干净 `0.2.1-rc.2`（`work\ai021clean`） | 本 fork 1.1.73 | `pending=63 applied=6 na=11 missing_file=1 skipped=1`，非软项仅 `#71` |
| 干净 `0.2.1-rc.2` | 社区 1.3.3 | `pending=64 applied=5 na=11 missing_file=1 skipped=2`（多 `#80`） |
| live `0.2.1-rc.2`（`%APPDATA%\DSH\data\versions\0.2.1-rc.2\...\@deepseek-ai`） | 本 fork 1.1.73 | `applied=70 na=11 missing_file=1`，**0 pending**（幂等重跑 0 改动） |

`#77 REWIND_DROP_SENT_ON_APPEND` 两边都补上了 0.2.1 的 `append()` 锚点
（0.2.1 把 `this.revised.clear();` 改成 `if (this.revised.size > 0) this.revised.clear();`），
本机实测已写入 `dsh-client-ui-conversation/lib/client.js`（`isRewindMarker` 分支位于 `append()` 第 2658 行附近，
文件 `node --check` 通过）。

---

## 6. 1.1.74 追加对比：对方也没修 `#121`

- 上游 [issue #121](https://github.com/YuJunZhiXue/dsh-purge/issues/121)（队列 `steer` 退化成 `followup`，`Ctrl+Enter`「插话发送」静默失效）**在社区 1.3.3 里同样存在**：其 `#86` 的 `replace` 依旧是
  `agent.steer(message);` → `agent.followup(message); // [dsh-purge-86] queue steer → next-turn`。
  两边的 `lib/core.js` 里 `[dsh-purge-86] queue steer` 文案一致（`1.1.71` 起就这样），所以它是**共有**缺陷，不是某一家的适配问题。
- 本 fork `1.1.74` 新增 `#90 SESSION_QUEUE_STEER_KEEP_MIDTURN` 修掉它（细节见 [MIGRATION-0.2.1.md](./MIGRATION-0.2.1.md) 第 7 节）。
  对方若要跟，注意其补丁表 id 已用到 `#89`，直接抄 `#90` 不会撞号。
- **发布形态**：本 fork 自 `1.1.74` 起照对方的样子发 GitHub Release（`dsh-purge-<版本>.tgz` + `SHA256SUMS.txt`），
  这样内置「添加插件」对话框里可以直接粘仓库地址或 release tgz 地址安装（见 README 的 Install 段）。

---

## 7. 1.1.75 追加对比：`{{cwd}}` 致命链，两边都中过，修法不同

dsh `0.2.1` 把 agent loop 注册的提示词变量从三个减到两个（去掉 `{{cwd}}`），于是**任何**带着 `{{cwd}}` 模板的提示词组装都会在发出请求前抛错：

```
unknown prompt variable "{{cwd}}" in section "deployment:persona-suffix"; registered variables: provider, model
```

- 本 fork `1.1.74` 及更早：由自带 `personaSuffix: Your working directory is {{cwd}}.` + `lib/identity.js` 的 `CWD_ONLY_SUFFIX` 触发，`0.2.1` 上 100% 复现；
- 社区 fork：同样在这条链上中过（其侧对应上游 `#114`/`#115`，并留下 `docs/CWD-COMPAT.md`），改法是 **personaSuffix 置空 + 运行时按 `assembled.variables` 里有没有 `cwd` 选动态/静态回退**。

本 fork `1.1.75` 的做法（见 [MIGRATION-0.2.1.md](./MIGRATION-0.2.1.md) 第 8 节）是同思路的三层防线，并且**额外**给宿主补注册了同名 `cwd` 变量，所以用户自己从 `0.2.0` 带过来的模板里写 `{{cwd}}` 也还能用；社区版只保证插件自己产出的段安全。

两处判断一致的结论：`{{cwd}}` 在 `0.2.1` 上不是「可选优化」，而是**升级阻断项**——只要模板里还剩一个，全部对话都发不出去。
