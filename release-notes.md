# 1.1.56

> 版本号对齐：`package.json` 版本改为 `1.1.56`，仓库地址与安装/更新源改指 `123ada11f/dsh-purge`。以下 1.2.3 及更早条目为历史 changelog，保留原样。

## 1.1.56 修订（2026-10-29）：桌面状态崩溃 + 备份/卸载闸门 + 测试与 CI 恢复

> 1. **修桌面面 `purge_status` 崩溃**：`lib/core.js` 里 `desktopCliEntryPatched()` 少了 `desktop.` 前缀直接调用，桌面宿主上 `status/apply/revert/uninstall` 全部 ReferenceError。改为 `desktop.desktopCliEntryPatched(...)`。
> 2. **原子写并发修复**：`atomicWriteSync/atomicWriteFile/atomicCopyFile` 的临时文件名从 `pid+Date.now()`（并发撞名、ENOENT）改为加 `randomUUID()`，rename 对 EPERM/EBUSY/EACCES 退避重试。压测 200 路并发写同一文件 0 失败。
> 3. **宿主发现不再误选备份/缓存/临时目录**：`findAiBaseRecursive` 排除 `purge-host-backup-*`、`$DSH_HOME/dsh-purge`、`_npx`/`_cacache` 与系统 Temp —— 此前会把 apply 打到自己留下的备份快照上。
> 4. **备份失败不再硬改宿主**：`applyPatchesAllHosts` 检查 `backupAll()` 的 errors，有失败即跳过该宿主并经 `backupErrors` 上报（此前返回值被丢弃，直接制造不可回滚状态）。
> 5. **卸载链路与 apply 对称**：改用 `revertAllHosts()`；shim 的 `error:*` 返回值显式扫描；flash/override/rules 任一失败即 `ok:false` 且不生成 cleanup；CLI `--uninstall` 现在真正调度 `result.cleanup` 的删除（原来忽略）。
> 6. **测试与 CI 恢复**：重建 `test/patch-health.test.mjs`、`test/backup-and-archive.test.mjs`、`test/update-selfuse-guard.test.mjs`（13 例，全程夹具隔离不碰真实宿主）；新增 `.github/workflows/ci.yml`（windows+ubuntu × Node 18/22/24）。双语 README 安装来源统一为本 fork。

## 1.1.56 破甲强化（2026-10-29，同日第二次）：recency 通道 + 开头锚 + 思考链覆盖 + 拒绝词表扩容

> 1. **user 尾部 nudge（新通道）**：新增 `lib/user-tail.js`，在 `agent/pre-step` 钩子上给最后一条 user 消息追加 80 字符执行指令——system 注入在长上下文里衰减，而最近一条 user 消息权重最高，两者正交。tuning 新增 `userTail`（默认 true），逐轮动态读取、无需重启。
> 2. **开头锚 + 思考链覆盖进加密槽**：注入文本新增「Opening Anchor」（首句必须是交付物，禁止任何前置）与「Think-chain coverage」（思考链不预演拒绝、只做交付规划）两节；槽体 21,194 → 21,666 字符，经 `embed-default-prompt.mjs` 重新加密嵌入 `lib/asset-table.js`。明文源 `lib/default-prompt-inject.md` 加入 .gitignore 不进仓库。
> 3. **refusal-retry 默认开启**：`tuning.js` 默认值 `refusalRetry: true`（merge 语义，显式关过的用户不受影响）。词表 12 → 22 条（补齐 "I have to decline"、"against my policy"、"out of scope"、"出于安全考虑"、"违反规定"、"请理解我不能"、"建议通过合法"、"温馨提示"、"不在我的能力范围"、"我理解你的请求但" 等），扫描窗口 400 → 1200 字符（`REFUSAL_SCAN_HEAD`）。
> 4. **anchor_miss 误报修复**：多候选锚点补丁任一命中后，其余候选不再逐条报漂移；只有整枚补丁全部失配才落审计。新增回归测试。
> 5. **审计汇流**：`lib/core.js` 新增 `setAuditSink/emitAudit`，由 `lib/index.js` 接到 `logAudit`，避免 core→audit 循环依赖。
> 6. **测试**：新增 `test/user-tail.test.mjs`（4 例），全套 23/23 通过，smoke 19/19。
# 1.2.3

> **自用版（personal trimmed build）。** 本版两块：对齐社区 `v1.6.5` 的 ASAR 判定修法（对应他仓库的 issue #5），以及把「远端列表取不到」从静默降级改成面板明示。
>
> 1. **Electron ASAR 判定改用真实磁盘**：`lib/surface.js` 原来用 `node:fs` 判断 resources 像不像桌面安装，其中 `statSync(app.asar).isFile()` 在 Electron 下恒为假——Electron 会把 `app.asar` 伪装成目录，这一条我们自己的 `lib/extract-asar.js:183` 早就写明，于是官方密封包可能被判成 Web 宿主。现在改用 `asarArchiveIsFile()` 与 `diskFs()` 探测归档与解开目录；这与社区 `v1.6.5` 把 `selfcheck` 的 reader 默认值换成 `diskFs()` 是同一个修法。
> 2. **远端列表取不到不再装「已是最新」**：`lib/update.js` 新增 `remoteStatusFrom()` / `remoteStatus()`，`listRemoteVersions()` 记录可达性，`checkUpdate()` 随结果返回 `remote:{ok,reason,status}`；api.github.com 未认证限流（403/429，60 次/小时）或网络失败时，设置页显示一行「取不到远端版本列表：…（下面只显示本机版本）」，而不是把本地版本当成远端最新版。
> 3. **发布资产**：`dsh-purge-1.2.3.tgz` + `SHA256SUMS.txt`。
>
> **Personal trimmed build.** Aligns with community `v1.6.5`'s ASAR fix (their issue #5) and stops pretending "up to date" when the remote list is unreachable. `lib/surface.js` now probes resources with `asarArchiveIsFile()` / `diskFs()` — under Electron `statSync('app.asar').isFile()` is always false because the archive is disguised as a directory (as our own `lib/extract-asar.js` documents), so a sealed official build could be misread as a Web host. `lib/update.js` gains `remoteStatusFrom()` / `remoteStatus()`; `checkUpdate()` returns `remote:{ok,reason,status}`, and the panel says the remote version list is unavailable (rate limit or network) instead of reporting the local version as the latest. Assets: `dsh-purge-1.2.3.tgz` + `SHA256SUMS.txt`.

# 1.2.2

> **自用版（personal trimmed build）。** 本仓库是自用版，功能不再等同于原作者完整版：只保留提示词与补丁清洗本体。
> 本版把自 `1.1.77` 起在本机累计的全部改动合并成一次发布 —— 只剩清洗本体，外加更新链路与备份链路上三处真 bug 的修复。
>
> **合并内容（自 `1.1.77` 起累计）**
>
> 1. **移除「演练台」与「红队模式」**：原作者把演练台（Drill 控制台）和红队模式（攻防演练预设 + 23 个红队技能）打在同一个包里，本机只做提示词与补丁清洗，用不到这两块网安测试功能。删除 `lib/redteam/`、`presets/redteam/`、`skills/redteam/`、`lib/drill-grant.js`、`scripts/redteam-setup.sh`、`scripts/build-client.mjs`、`scripts/patch-client-dock.mjs`、`scripts/export-engagement-report.mjs` 与演练台截图；`cordis.patch.yml` 去掉三条 `dsh-purge-redteam*` insert 与 `root: $DSH_HOME/redteam`；`package.json` 去掉 `./redteam*` 四条 exports 与 `build:client`；`client.js` 去掉内嵌演练台块（约 4200 行）、授权闸门 `AuthGate`、环境适配门禁 `EnvAdaptSendGate`、全部 `/redteam/api` 与 `/dsh-purge/drill-grant` 调用；宿主侧去掉红队指挥稿、角色段回填、CTF 段与子代理角色捕获（`lib/identity.js`、`lib/capability-protocol.js`、`lib/index.js`、`lib/uninstall.js`）。运行时不再生成 `$DSH_HOME/redteam` 与 `$DSH_HOME/.agent-presets/redteam`，右侧栏只剩「清洗」一页。
> 2. **去掉启动必弹的「用户须知」**：`WelcomeNotice` 组件、`welcome.*` 文案、`WELCOME_KEY` 认知位与它专用的 `dshp-auth-*` 样式全部删除。它每次启动都弹，是因为确认位存在 `localStorage`，而落盘键按 origin 隔离、`dsh web` 每次启动端口都变，上一次的确认永远读不回来。
> 3. **修 upstream #127（备份从来没建立过）**：`hostFs`（`lib/extract-asar.js`）的方法白名单漏了 `closeSync`，而 `backupAll()` 用 `fs.openSync(bak,"wx")` 建占位句柄后立刻 `fs.closeSync(fd)` —— 那是 `undefined`，TypeError 被 `catch {}` 吞掉，句柄始终开着；Windows 上未关闭的句柄让随后的 `rename(tmp, bak)` 报 `EPERM`，于是整机 `.dshpurge.bak` 恒为 0，还原、缺文件自愈、卸载回滚全部空转。现在按 fd 直连真实磁盘补齐 `closeSync/readSync/writeSync/fsyncSync`。
> 4. **修 upstream #118（`file:` 装成 .tgz 后终身更新失败）**：profile 写 `dsh-purge: file:.../dsh-purge-1.2.1.tgz` 时，`planUpdates()` 把这个文件当源码目录，`ENOTDIR: not a directory, lstat '<tgz>/lib'` 每次更新重犯。现在 `materializeArchiveTarget()` 先把归档解到 `$DSH_HOME/dsh-purge/updates/<包名>/` 再当目录用，`extractTarGz()` 是纯 Node 的最小 ustar 解包。
> 5. **更新源改指本 fork + 拒收上游完整包**：`lib/update.js` 的 `REPO` 改为 `123ada11f/dsh-purge`，面板只列 `master` 与自己打的 `<版本>-selfuse` 标签；git 与 zip 两条通道在写盘前都用 `packageLooksUpstream()` 检查目标那版的 `package.json`，带 `./redteam` 导出（=上游完整包）就直接拒绝覆盖 —— 否则一次「切换版本」会把演练台与红队模式整块带回来。
> 6. **自检口径修复**：`classifyPatchHealth` 不再把 `missing_file` 判成 `pending`（归 `settled`），修掉「63/64 applied, 0 pending」与「自检: pending」自相矛盾那一条。
> 7. **发布资产**：`dsh-purge-1.2.2.tgz` + `SHA256SUMS.txt`。
>
> **Merged release (personal trimmed build).** Everything accumulated since `1.1.77` lands in one release: the Drill console and Red-team mode are gone (including their preset, 23 skills, dock tab, auth gate, env gate, `./redteam*` exports and `$DSH_HOME/redteam` state), the startup "user notice" modal is gone, upstream #127 (backups were never created: `hostFs` lacked `closeSync`, so the placeholder handle stayed open and every `rename` failed with `EPERM`) and upstream #118 (`file:`-installed `.tgz` made every later update die with `ENOTDIR`) are fixed, and the update source now points at this fork (`123ada11f/dsh-purge`) with a guard that refuses any target exporting `./redteam`.

# 1.2.1

> **自用版声明。** 本仓库是自用版，功能不再等同于原作者完整版：只保留提示词与补丁清洗本体，原作者捆绑的「演练台」「红队模式」已删除。上游完整版见 [YuJunZhiXue/dsh-purge](https://github.com/YuJunZhiXue/dsh-purge)。
>
> **本机精简版改动（2026-10-18）：移除「演练台」与「红队模式」**
> 作者原版把演练台（Drill 控制台）和红队模式（攻防演练预设 + 23 个红队技能）打在同一个包里，这两块是给网安测试用的，本机用不到，已整块剥掉，只留清洗本体。
>
> - 删除随包资产：`lib/redteam/`、`presets/redteam/`、`skills/redteam/`、`lib/drill-grant.js`、`scripts/redteam-setup.sh`、`scripts/build-client.mjs`、`scripts/patch-client-dock.mjs`、`scripts/export-engagement-report.mjs`、`docs/drill-auth-legal.html`、`docs/redteam-upstream-DISCLOSURE`、`docs/redteam-upstream-LICENSE` 与演练台截图。
> - `cordis.patch.yml` 去掉 `dsh-purge-redteam`、`dsh-purge-redteam-store`、`dsh-purge-redteam-ui` 三条 insert 与 `root: $DSH_HOME/redteam` 配置；`package.json` 去掉 `./redteam*` 四条 exports、`build:client` 脚本与红队相关关键词。
> - `client.js` 去掉内嵌演练台块（约 4200 行）、授权闸门 AuthGate、环境适配门禁 EnvAdaptSendGate、全部 `/redteam/api` 与 `/dsh-purge/drill-grant` 调用，以及 `dock.drill` / `auth.*` / `envGate.*` 文案；右侧栏只剩「清洗」一页。
> - 宿主侧去掉红队指挥稿、角色段回填、CTF 段与子代理角色捕获：`lib/identity.js`、`lib/capability-protocol.js`、`lib/index.js`、`lib/uninstall.js`（`drillGrantCleared`）。
> - 运行时不再生成 `$DSH_HOME/redteam`、`$DSH_HOME/.agent-presets/redteam` 与 `drill-grant.json`。
> - 去掉启动时必弹的「用户须知」窗（`WelcomeNotice` 组件、`welcome.*` 文案、`WELCOME_KEY` 认知位、以及它专用的 `dshp-auth-*` 样式）。它每次启动都弹，是因为认知位存在 `localStorage`，而落盘键按 origin 隔离、`dsh web` 每次启动端口都变（64006 → 55031 → 50014…），上一次的确认永远读不回来。
> - **更新源改指自己的 fork**：`lib/update.js` 的 `REPO` 由 `YuJunZhiXue/dsh-purge` 改为 `123ada11f/dsh-purge`（版本列表、zipball / tarball、jsdelivr 与 atom 兜底全用它），更新面板只列 `master` 与自己打的 `<版本>-selfuse` 标签（`SELFUSE_TAG_RE`）。另加一道闸门 `packageLooksUpstream()`：git 与 zip 两条通道在写盘前先读目标那一版的 `package.json`，只要带 `./redteam` 导出（=上游完整包）就直接拒绝覆盖 —— 否则一次「切换版本」会把演练台与红队模式整块带回来。要放行得显式传 `allowUpstream: true`（面板不传）。
>
> **Update source moved to this fork / guard against re-adding upstream.** `lib/update.js` now points `REPO` at `123ada11f/dsh-purge` and lists only `master` plus own `<version>-selfuse` tags. Both update lanes (git reset, zip overlay) call `packageLooksUpstream()` before writing: a target whose `package.json` exports `./redteam` is refused, so a single "switch version" click can no longer bring the Drill console and Red-team mode back.
>
> **Removed: Drill console + Red-team mode (2026-10-18).** Both were security-testing features bundled in the same plugin. Dropped `lib/redteam/`, `presets/redteam/`, `skills/redteam/`, `lib/drill-grant.js`, the redteam insert rows in `cordis.patch.yml`, the `./redteam*` exports, the embedded drill block plus auth gate / env gate in `client.js`, and the red-team prompt sections in `lib/identity.js` / `lib/capability-protocol.js` / `lib/index.js`. The dock now has a single Clean page, and no `$DSH_HOME/redteam` state is created.

## 中文

- 版本 **1.2.1**。内容等同 `1.1.77`（= `1.1.76` 的修复与新功能，去掉「预设自动登记」），外加一处自检口径修复。
- **为什么直接从 `1.1.77` 跳到 `1.2.1`**：中途有一批预热用的 `1.2.0` 资产（只在本机打过 tgz，没发布过 Release）。插件的自动更新是**数值比较**（`lib/update.js` 的 `versionIsNewer`，先比三段数字），`1.1.77 < 1.2.0`，所以装过 `1.2.0` 的实例会被判成「已是最新」，永远升不回来。发 `1.2.1`（> `1.2.0`）一次性覆盖掉这段残留；`1.2.1` 之后建议回到只递增 patch 位的老规矩。
- **修复自检口径不一致**：`classifyPatchHealth` 曾把 `missing_file` 判成 `pending`，于是没装 `preset-liangshen` 的机器上，`purge_status` 会上一行写「63/64 applied, 0 pending」、下一行写「自检: pending (pending 1)」，点多少次应用都消不掉。现在 `missing_file` 归 `settled`（与 display 层的 `skipped` 同源，`ALWAYS_SOFT_STATUSES` 本来就把它算作软状态），`read_error` 仍算 `pending`（文件在但读不出来，重试有意义）；`ALWAYS_SOFT_STATUSES` 改为导出，新增 `test/patch-health.test.mjs` 7 例把这条不变式钉住。
- **修 upstream #127（备份从来没建立过）**：`hostFs`（`lib/extract-asar.js`）的方法白名单漏了 `closeSync`，而 `backupAll()` 用 `fs.openSync(bak,"wx")` 建占位句柄后立刻 `fs.closeSync(fd)` —— 那个调用是 `undefined`，TypeError 被 `catch {}` 吞掉，句柄**始终开着**。Windows 上未关闭的句柄让随后 `rename(tmp, bak)` 报 `EPERM`，于是每个文件都走「删占位 + 记 error」分支：整机 `.dshpurge.bak` 恒为 0，`purge_status` 里的还原、`restoreMissingOriginalsFromBak` 的缺文件自愈、卸载回滚全部空转。现在按 fd 直连真实磁盘补齐 `closeSync/readSync/writeSync/fsyncSync`，并加 `test/backup-and-archive.test.mjs` 钉住「关闭后能被 rename 覆盖」这条序列。
- **修 upstream #118（`file:` 装成 .tgz 后终身更新失败）**：profile 里写 `dsh-purge: file:.../dsh-purge-1.2.1.tgz` 时，`planUpdates()` 把这个**文件**当源码目录，`overlayFromZip()` 对 `<xxx.tgz>/lib` 报 `ENOTDIR: not a directory, lstat`，且每次更新重犯、永不自愈。现在 `materializeArchiveTarget()` 先把归档解到 `$DSH_HOME/dsh-purge/updates/<包名>/` 再当目录用，`extractTarGz()` 是纯 Node 的最小 ustar 解包（顶部 `package/` 前缀、目录项、pax 头跳过、越界条目直接报错），不依赖系统 tar。
- 发布资产：`dsh-purge-1.2.1.tgz` + `SHA256SUMS.txt`。
- **更新源与闸门**：`REPO` 指本 fork（`123ada11f/dsh-purge`），标签只列 `<版本>-selfuse`；`applyUpdate` 的 git / zip 两条通道写盘前都用 `packageLooksUpstream()` 拦一次上游完整包（带 `./redteam` 导出的 `package.json`），命中就抛「目标版本是上游完整版…自用版拒绝覆盖」。新增 `test/update-selfuse-guard.test.mjs` 4 例。

## English

- Version **1.2.1**. Contents are identical to `1.1.77` (the fixes and features of `1.1.76` minus the "automatic preset registration"), plus one self-check reporting fix.
- **Why jump straight from `1.1.77` to `1.2.1`**: a warm-up batch of `1.2.0` assets existed (tgz built locally, never published as a Release). The plugin's auto-update compares versions **numerically** (`versionIsNewer` in `lib/update.js`, core triple first), and `1.1.77 < 1.2.0`, so any instance that installed `1.2.0` would be told it is already up to date and could never come back. Shipping `1.2.1` (> `1.2.0`) clears that residue in one step; after `1.2.1`, stick to patch-only bumps again.
- **Fixed an inconsistent self-check**: `classifyPatchHealth` used to classify `missing_file` as `pending`, so on a machine without `preset-liangshen`, `purge_status` printed "63/64 applied, 0 pending" on one line and "self-check: pending (pending 1)" on the next — and no amount of clicking Apply cleared it. `missing_file` is now `settled` (the same thing as `skipped` in the display layer, and `ALWAYS_SOFT_STATUSES` already treated it as soft), while `read_error` stays `pending` (the file is there but unreadable, so a retry is meaningful). `ALWAYS_SOFT_STATUSES` is now exported, and `test/patch-health.test.mjs` pins this invariant with 7 cases.
- **Fixed upstream #127 (backups were never created)**: the `hostFs` allow-list in `lib/extract-asar.js` lacked `closeSync`, while `backupAll()` opens a placeholder with `fs.openSync(bak,"wx")` and then calls `fs.closeSync(fd)` — that call was `undefined`, the `TypeError` was swallowed by `catch {}`, and the handle **stayed open** forever. On Windows an unclosed handle makes the following `rename(tmp, bak)` fail with `EPERM`, so every file fell into the "unlink placeholder + record error" branch: `.dshpurge.bak` count stayed at 0 machine-wide, and revert / `restoreMissingOriginalsFromBak` self-heal / uninstall rollback all silently did nothing. The fd-based methods (`closeSync/readSync/writeSync/fsyncSync`) now go straight to real disk, and `test/backup-and-archive.test.mjs` pins the "closable then renameable" sequence.
- **Fixed upstream #118 (installed from a `.tgz`, updates failed forever)**: when a profile declares `dsh-purge: file:.../dsh-purge-1.2.1.tgz`, `planUpdates()` treated that **file** as a source directory, so `overlayFromZip()` hit `ENOTDIR: not a directory, lstat` on `<xxx.tgz>/lib` — and it recurred on every update with no self-healing. `materializeArchiveTarget()` now unpacks the archive into `$DSH_HOME/dsh-purge/updates/<name>/` first, and `extractTarGz()` is a dependency-free minimal ustar reader (strips the top-level `package/` prefix, skips pax headers, rejects entries escaping the destination).
- Release assets: `dsh-purge-1.2.1.tgz` + `SHA256SUMS.txt`.

# 1.1.77

## 中文

- 版本 **1.1.77**。**撤销 1.1.76 里的「预设自动登记」**：那一版把随包 `presets/redteam` 自动登记进宿主 `agentPresets` 注册表，这跟「提示词预设（换提示词）」不是一回事，已按反馈整块移除。
- 移除清单：`lib/presets.js`、`lib/presets-plugin.js`、`GET /dsh-purge/presets` 路由与 `status` 里的 `presets` 字段、面板「诊断台 → 预设」页签、`cordis.patch.yml` 里的 `dsh-purge-presets` 插件条目、`package.json` 的 `./presets` / `./presets/lib` 两条 exports，以及对应测试与 smoke 项。
- `lib/redteam/index.js` 恢复 1.1.75 的自登记行为：演练台（红队模式）预设照旧出现在宿主模式下拉里，行为与 1.1.76 之前完全一致。
- 1.1.76 的其余内容保持不变：`toolFilter` 崩溃修复、`atomicCopyFileSync` 异步误用修复、锚点漂移巡检 + 半自动重锚、`pending`/`broken` 三态自检、注入探针、审计日志、补丁 **#89 `ASK_USER_NO_BLOCK`**、`test/` 与 `scripts/smoke.mjs`。

## English

- **1.1.77**. **Removes the "automatic preset registration" added in 1.1.76**: that release registered the bundled `presets/redteam` into the host `agentPresets` registry, which is not the same thing as a prompt-preset picker, so it is gone.
- Removed: `lib/presets.js`, `lib/presets-plugin.js`, `GET /dsh-purge/presets` plus the `presets` key in `status`, the "Diagnostics → Presets" tab, the `dsh-purge-presets` entry in `cordis.patch.yml`, the `./presets` exports in `package.json`, and the matching tests / smoke checks.
- `lib/redteam/index.js` is back to its 1.1.75 self-registration: the drill (red-team) preset still shows up in the host mode dropdown, exactly as before 1.1.76.
- Everything else from 1.1.76 is unchanged: the `toolFilter` crash fix, the `atomicCopyFileSync` async fix, anchor drift + re-anchoring, the `pending`/`broken` three-state check, the injection probe, the audit log, patch **#89 `ASK_USER_NO_BLOCK`**, `test/` and `scripts/smoke.mjs`.

# 1.1.76

## 中文

- 版本 **1.1.76**。这一版把「宿主升级后怎么知道自己坏了、坏了怎么救」补齐，并修掉两个会真的出事的 bug。补丁表 **84 条**（新增 #89）。
- **P0 修 `toolFilter` 崩溃（1.1.75 起一直带着）**：0.2.1 的 `dsh-tool-subagent` 见到配置里的 `persona` / `toolFilter` 就直接抛错，而随包 `presets/redteam/agent.cordis.yml` 还写着 `toolFilter: deny: [...]` → 整份预设挂载失败、选择器标红。现在模板删掉该段，并在 `lib/redteam/index.js` 加了 `repairToolFilter()`：已装在 `<DSH_HOME>/.agent-presets/` 里的旧副本会在下次启动时就地摘掉该段（自愈链 rendered → tools → filtered → delegation）。
- **P0 修 `repairOfficialCliAfterUnpack` 异步误用**：该函数是同步的，却 `try { atomicCopyFile(fp, bak) } catch {}` 调用异步函数，异常落进 unhandled rejection；Node 22+/24 默认 `--unhandled-rejections=throw`，会在加载期直接**杀掉宿主**（并且 `.bak` 可能存成补丁后的字节）。新增 `atomicCopyFileSync()`（临时文件 + rename，失败 unlink 后 rethrow）并在该处替换。
- **P1 锚点漂移巡检 + 半自动重锚**：`core.patchDrift()` 逐条比对锚点，给出候选行号与上下文；`lib/anchors.js` 维护 `<DSH_HOME>/dsh-purge/anchor-overrides.json`；面板「诊断台 → 漂移巡检」可一键重锚，`POST /dsh-purge/reanchor` 亦可脚本化。
- **P1 三态自检**：`classifyPatchHealth()` 把 `pending`（再点一次应用即可）和 `broken`（锚点没了，要重锚）分开；`purge_status` 与 `/dsh-purge/status` 都带 `patch_health`。
- **P1 测试工程化**：新增 `test/`（`node --test`，7 个文件 55 例）与 `scripts/smoke.mjs`（23 项打包形状自检）。全部用例 import 真实 `lib/*.js`、用 `mkdtemp` 隔离临时目录，不复刻补丁判定逻辑。
- **P2** 注入探针（`/dsh-purge/probe`，30 分钟 nonce + 回显校验）、审计日志（`/dsh-purge/audit`，追加写 + 1MB 轮转）、预设自动登记进宿主 `agentPresets` 选择器（`/dsh-purge/presets`）、新补丁 **#89 `ASK_USER_NO_BLOCK`**（ask_user 默认前台等待 120s → 1s，不再挂住整轮；想等人的调用仍可自己传 `timeout`）。
- 面板新增「诊断台」区块：漂移巡检 / 注入探针 / 审计 / 预设四个页签。

## English

- **1.1.76**. Adds host-upgrade drift detection and recovery, and fixes two real bugs. The patch table now has **84 entries** (new #89).
- **P0 — `toolFilter` crash**: on 0.2.1 `dsh-tool-subagent` throws on `persona` / `toolFilter`, while the bundled `presets/redteam/agent.cordis.yml` still carried `toolFilter: deny: [...]`, so the whole preset failed to mount. The template drops it and `repairToolFilter()` strips it from already-installed copies at startup.
- **P0 — async misuse in `repairOfficialCliAfterUnpack`**: a synchronous function called the async `atomicCopyFile()` inside `try/catch`, leaving an unhandled rejection that Node 22+/24 turns fatal. New `atomicCopyFileSync()` (temp file + rename, unlink then rethrow) replaces it.
- **P1 — anchor drift + re-anchoring**: `core.patchDrift()` reports the candidate line and snippet per drifted anchor; `lib/anchors.js` keeps `<DSH_HOME>/dsh-purge/anchor-overrides.json`; re-anchor from the panel or via `POST /dsh-purge/reanchor`.
- **P1 — three-state self-check**: `classifyPatchHealth()` separates `pending` (apply again) from `broken` (anchor gone, re-anchor first); exposed as `patch_health` in `purge_status` and `/dsh-purge/status`.
- **P1 — tests**: `test/` with `node --test` (7 files, 55 cases) plus `scripts/smoke.mjs` (23 package-shape checks), all importing the real `lib/*.js` against `mkdtemp` fixtures.
- **P2** — injection probe (`/dsh-purge/probe`), audit log (`/dsh-purge/audit`), automatic registration of bundled presets into the host `agentPresets` picker (`/dsh-purge/presets`), and new patch **#89 `ASK_USER_NO_BLOCK`** (default `ask_user` foreground wait 120s → 1s).
- New "Diagnostics" panel section with drift / probe / audit / presets tabs.
# 1.1.75

## 中文

- 版本 **1.1.75**。
- 修 0.2.1 上**任何对话都无法回复**的致命故障：宿主 0.2.1 的 agent loop 只注册 `provider` / `model`，而本插件的 bundle patch 里 `personaSuffix` 仍引用 `{{cwd}}` → 提示词插值阶段直接抛 `unknown prompt variable "{{cwd}}" in section "deployment:persona-suffix"; registered variables: provider, model`，每一轮都在发请求前失败。
- 三层防线：① `cordis.patch.yml` 的 `personaSuffix` 置空；② `lib/index.js` 启动时清扫配置里残留的 `{{cwd}}` 引用并记日志；③ `lib/index.js` 发现宿主没有 `cwd` 变量时补注册兼容变量（宿主支持动态变量就用动态值，否则静态回退）。
- 新增回归自检 `tools/cwd-check.mjs`（7/7）与 A/B 复现叠加层 `tools/ab/ov-cwd-{bad,good}.yml`；`tools/README.md` 记录用法（真机 `--patch` 端到端复现已实测）。
- 同时包含 **1.1.74** 的 `#90`：修 upstream issue #121（`Ctrl+Enter` 插话静默失效）。

## English

- **1.1.75**.
- Fixes the fatal "every turn fails" bug on dsh 0.2.1: the 0.2.1 agent loop registers only `provider` / `model`, while this plugin's bundle patch still referenced `{{cwd}}` in `personaSuffix`, so prompt interpolation threw `unknown prompt variable "{{cwd}}"` before any model request.
- Three layers: blank `personaSuffix` in `cordis.patch.yml`; scrub leftover `{{cwd}}` references at startup; register a compatibility `cwd` variable at runtime when the host does not provide one (dynamic when available, static fallback otherwise).
- New regression check `tools/cwd-check.mjs` (7/7) plus A/B overlays `tools/ab/ov-cwd-{bad,good}.yml`.
- Also includes **1.1.74** `#90`: fixes upstream issue #121 (silent `Ctrl+Enter` steer failure).

# 1.1.74

## 中文

- 版本 **1.1.74**。
- 修 upstream issue #121：队列 `steer` 被 #86 改成 `followup`（下一轮），但守卫与前端仍按 next-turn 取件 → `Ctrl+Enter`「插话发送」静默失效（`session/steer-unavailable` 被前端吞掉）。新增补丁 **#90 `SESSION_QUEUE_STEER_KEEP_MIDTURN`** 把该分支收回 `agent.steer(message)`（注入当前轮），并兼容 #86 产物与出厂原文两种形态。
- `package.json` 指向本维护 fork：`repository` / `homepage` / `bugs` / `dsh.install`（首选 tarball）、`files` 带上 `tools`；`dshTarget` = `0.2.1-rc.2`。
- 每个 Release 附 `dsh-purge-<version>.tgz` 与 `SHA256SUMS.txt`，可被 dsh 内置「添加插件」直接安装。
- `docs/COMPARE-community-1.3.3.md` 记录与社区 fork（`kingcharleslzy-ai/dsh-purge` 1.3.3）的逐条差异：其一并未修 #121。

## English

- **1.1.74**.
- Fixes upstream issue #121: the queue `steer` case was changed to `followup` by #86 while the guard and the client still resolved next-turn items, so `Ctrl+Enter` steering failed silently. New patch **#90 `SESSION_QUEUE_STEER_KEEP_MIDTURN`** restores `agent.steer(message)` for that branch.
- `package.json` now points at this maintained fork (`repository` / `homepage` / `bugs` / `dsh.install`, tarball preferred; `files` includes `tools`); `dshTarget` = `0.2.1-rc.2`.
- Every release ships `dsh-purge-<version>.tgz` + `SHA256SUMS.txt` for the built-in plugin installer.

# 1.1.71

## 中文

- 版本 **1.1.71**。
- 修复 1.1.70 的 `??` 混 `||`：插件启用时 `failed to import`（桌面 / Web 同一入口）。
- #86 只改 UI 队列 steer → followup；公共 `steer()` 收回 next-step，代理间 `send_message` 仍下一步插入。
- `installed-rev` 跨版本不再沿用旧 `apply:x.y.z`。#88 按现行 `renderedPrompt` / 旧 `system` 锚点打中的那条落标记。
- 发版前 `node --check` 主入口，避免再把语法错误打进 Release。

## English

- **1.1.71**.
- Fix 1.1.70 `??` mixed with `||`: enable failed to import on desktop and web.
- #86 keeps UI queue steer → followup. Public `steer()` is next-step again so `send_message` inserts at the next step.
- Stale `apply:x.y.z` in `installed-rev` refreshes across versions. #88 marks the host anchor that actually exists (`renderedPrompt` or `system`).
- Release CI syntax-checks the plugin entry.

# 1.1.70

## 中文

- 版本 **1.1.70**。
- Hub / 残装若给 `dsh-purge` 加上 `pluginPackages`，Cordis 会一直 pending，宿主退出码 1。本版把依赖钉回 `systemPrompt` + `tools`。
- 清洗页只合并升级链展示（免责、审批、挂全文、hooks 等），Apply 仍打全部补丁。
- 去掉已无用的 #81 / #89 清单行；挂全文并进 #87，官方 phase-1 走静默放行。
- 指挥端改为「按用户给的目标开工」。合并 #97 / #98 / #99。

## English

- **1.1.70**.
- Hub / incomplete installs that inject `pluginPackages` leave dsh-purge pending and kill the host. Dependencies are pinned to `systemPrompt` + `tools`.
- Clean page groups upgrade-chain patches for display only; Apply still writes every patch.
- Dropped dead #81 / #89 rows. Hang lives in #87. Official phase-1 keep is silent.
- Commander bind: start from the user's target. Includes #97 / #98 / #99.

# 1.1.69

## 中文

- 版本 **1.1.69**。
- 发送时剥掉 ChatML / `project_instructions`，框和磁盘不动。
- 应用 + 重启挂当前默认，不必再点保存；框里仍是插件旧默认会刷到加密槽。
- 红队只排不折：注入 → cap → 红队正文；目标卡/角色段改名 `dshpg-*`。
- 隔离 ctx 也注册 inject/cap；#86 steer 改 next-turn；#87 hang 用 LF 比对。
- 红队操作稿锁「上面的提示词作准」；指挥端去掉「给了单位名就授权」。

## English

- **1.1.69**.
- Peel ChatML / `project_instructions` on the wire; box and disk stay intact.
- Apply + restart hangs the current default; no extra Save. Stale plugin defaults refresh from the sealed slot.
- Redteam: inject → cap → ops only (no fold). Card/role sections renamed `dshpg-*`.
- Isolated ctx also registers inject/cap. #86 steer → next-turn. #87 hang needle uses LF.
- Redteam ops note: inject wins. Commander no longer says a company name means authorized.

# 1.1.68

## 中文

- 版本 **1.1.68**。
- **#92**：技能面板认 YAML 块标量 `description`（`|` / `>`），不再误报不可用。
- **#93**：红队「版本/更新」：`file://` 转成本地路径；Windows 用 `.cmd` + `shell` 起 npm/pnpm；npm 404 回落 GitHub tags。
- **#94**：官方桌面 CLI 入口补 `app.asar.unpacked` 回退。Hub 首次安装仍可能撞官方 asar 路径。
- **#95**：拆除 `refusal-recover`（读错字段永不触发；修好会无限复读）。
- **#96**：bash 前台等待从插件标过的 600s 迁回 60s，后续工具不再被堵 10 分钟。
- 注入置顶；capability 段改名 `dshpg-capabilities`；用户 prompt 一律 followup（#85）；默认关闭自动「继续」。

## English

- **1.1.68**.
- **#92**: Skill panel parses YAML block-scalar `description`.
- **#93**: Redteam update: `file://` → fs path; Windows npm/pnpm via `.cmd`; GitHub tags if registry 404.
- **#94**: Desktop CLI falls back to `app.asar.unpacked`. Hub first-install may still hit stock asar.
- **#95**: Removed `refusal-recover` (dead reader / unbounded nudge loop).
- **#96**: Restore marked bash foreground wait 600s → 60s.
- Inject leads; capability section renamed; user prompt always followup; autoContinue default off.

# 1.1.67

## 中文

- 版本 **1.1.67**。
- **#85**：continue 续跑在传输/429 连错时不再无限兜圈。`takeContinue` 加 failStreak 阈值；`refundContinue` 不清 `lastContinueSeq`，连错 ≥3 直接放弃。
- **#84**：区域拦截的空 Assistant 流改为单批 `text-chunks` 记录（带 `.length`），不再卡住宿主 UI。
- 启动种子：进程启动时若 `$DSH_HOME/prompt-inject.md` 为空或缺失，自动把加密默认稿写一次；用户改过的稿不动。清洗完点重启后，重启成功立刻就能用默认提示词。
- Windows 官方包重启：restart 脚本名改成 `pid+random`，首启不与并发实例打架；多余的 `.cmd` 中介删掉，直接 `wscript.exe //nologo //B` 起脚本；本机旧版无 pid 后缀的脚本/日志超过 24h 启动时自动清。
- 杀进程范围收紧：`ASAR_SWAP_PS1` 不再 `/IM` 杀全名同名进程，只按安装根下 pid 停，避免误伤第三方同名。
- 官方 CLI shim 原地改写之前先存一份 `.dsh-purge.bak`，并走原子写，断电/盘满可回退。
- 首装场景不卡：WScript 判 clean 时，两边都是 null（文件缺或读失败）放行启动，只有任一明确 dirty 才拦。
- 探测缓存：`runningExes` / `shortcutExes` 空结果不再缓存；点"应用"前 `clearDesktopLocateCache()` 仍可强刷。
- `scheduleAsarRenameWhenIdle` 的 `.rename-pending` 锁：时钟回拨或超过 30 分钟视为失效，清掉重做。
- `execFileSync` 三处 PowerShell 调用加 `maxBuffer: 8MB`，大结果不再静默 ENOBUFS 掉。
- 其他：net-scope region gate 指数退避 + IPv6 regex 收紧；identity `injectMatchers` 支持 >4096 分段匹配、`installAssembleGuard` 幂等；hooks-deny 删 R0 兜底规则改原子写；extract-asar commit 不删 `nextDir`，写 `.dshpurge-recover.json` 便回滚；client.js redteam preset 多路检测、shell.submit WeakMap 清理补齐。

## English

- **1.1.67**.
- **#85**: Continue loop no longer spins forever on TRANSPORT/429 streaks. `takeContinue` adds a failStreak gate; `refundContinue` leaves `lastContinueSeq` set; 3 consecutive failures abandon.
- **#84**: Region-gate empty-assistant stream becomes one batched `text-chunks` record (with `.length`), no longer hangs the host UI.
- Boot-time seeding: on startup, if `$DSH_HOME/prompt-inject.md` is empty or missing, the encrypted default is written once; a user-edited file is untouched. After the Apply → cleanup → restart cycle, the default prompt is active immediately.
- Windows official-build restart: restart script name now includes `pid+random`, so concurrent instances don't clobber each other; the `.cmd` intermediary is dropped — `wscript.exe //nologo //B` is spawned directly; legacy unsuffixed scripts/logs older than 24h are purged on each startup.
- Kill scope tightened: `ASAR_SWAP_PS1` no longer uses `/IM` to kill by full name — only pids under the install root are stopped, so same-named third-party processes aren't collateral.
- Official CLI shim repair now saves `.dsh-purge.bak` and uses atomic write before overwriting, so power loss / disk full is recoverable.
- First-install not blocked: when WScript checks for clean markers, two nulls (missing or unreadable) now pass through; only an explicit `false` blocks startup.
- Probe caches: `runningExes` / `shortcutExes` no longer cache empty results; `clearDesktopLocateCache()` on Apply still forces a refresh.
- `scheduleAsarRenameWhenIdle` `.rename-pending` lock: clock skew or ≥30-min-old lock is treated as stale and cleared.
- Three `execFileSync` PowerShell calls get `maxBuffer: 8MB` so large results no longer silent-fail with ENOBUFS.
- Also: net-scope region-gate exponential backoff + stricter IPv6 regex; identity `injectMatchers` segments >4096-char payloads, `installAssembleGuard` is idempotent; hooks-deny drops R0 fallback and uses atomic write for state; extract-asar commit no longer deletes `nextDir` and writes `.dshpurge-recover.json` for rollback; client.js redteam preset detection broadened; `shell.submit` WeakMap cleanup wired.

# 1.1.66

## 中文

- 版本 **1.1.66**。
- **#80**：清洗页可关掉 hooks deny / ask 旁路。关掉且文件干净显示跳过，不计入已应用；关掉后再打开，64/65 会按官方形态再打一次。
- **#81**：继续 / 拒答续跑的来源 kind 改为 `dsh-purge`；限流和传输失败不再自动续一轮。
- 重启后不用点保存也会挂上默认提示词；每一轮都补回全文。空的应用请求不再清空磁盘上的提示词。
- 声明过的 overlay 只剩 `.dshpurge.bak` 时，应用会先拷回再加载。
- 红队报告补上得分点短名。中文 README 恢复题图和预览图。

## English

- **1.1.66**.
- **#80**: The clean page can turn off the hooks deny/ask bypass. Off + clean files show skipped and are not counted as applied. Turning it back on reapplies 64/65 from the official form.
- **#81**: Continue / refusal-recover use source kind `dsh-purge`. RATE_LIMIT and TRANSPORT no longer start another continue turn.
- Restart hangs the default prompt without a Save click; every step puts the full text back. An empty Apply body no longer wipes the disk prompt.
- A declared overlay that exists only as `.dshpurge.bak` is copied back before load.
- Red-team reports get short score-point names. Chinese README restores the banner and preview images.

# 1.1.65

## 中文

- 版本 **1.1.65**。
- 默认提示词按 `lib/default-prompt-inject.md` 重新加密进槽。磁盘上仍是用户自己改过的稿时，不覆盖。
- 红队接入截图登记、得分点看图，以及报告六段。可把某次演练导出成目录。
- 技能正文缺工具路径、缺密钥或 VPS 还是占位符时，不再把整条技能标成不可用。缺口留在详情里。
- 打开页面或组装提示词时，会把当前默认稿同步到磁盘，不必先点保存。
- 删掉没有调用的桌面启动封装、旧迁移脚本，以及已经注释掉的手动继续入口。

## English

- **1.1.65**.
- The default prompt is sealed again from `lib/default-prompt-inject.md`. A prompt the user already edited on disk is left as-is.
- Red team gains shot registration, score-point images, and the six-part report. An engagement can be exported to a folder.
- A skill stays usable when a documented tool path, key, or VPS placeholder is missing. The gap stays on the skill detail.
- Opening the page or assembling the prompt writes the current default to disk, without a Save click first.
- Unused desktop launch helpers, the old migration script, and the commented manual-continue entry are removed.

# 1.1.64

## 中文

- 版本 **1.1.64**。
- 红队流程八项。角色稿只在**新建靶标**时播种；已经建好的靶标，要在演练台里把智能体同步一次才会换成新稿。
- **内网**改为叶子节点，自己按收集、梳理、发现、利用做，不再往下派活。
- 并发名额：不带 key 的 release 只放最早的一条。子智能体结束由服务端自动释放；手动释放必须带上 acquire 返回的 key。
- 预检带 `include` 时只体检点名的技能，不再被全局缺密钥拖成失败。缺项带上由用户执行的修复说明。
- IPv6 计分至少两个冒号，`dc01:389` 这类主机名不再 ×3。计分只留在 `score-rules.js`。
- 攻击链计分跳过已停用的得分点。
- `.env` 认 `export KEY=value`。未加引号的行内注释会剥掉，引号里的 `#` 保留。
- 内网计分 code 改为 `central-system`、`boundary-logical`、`boundary-strong` 等，以 `redteam_score_list` 实际返回为准。
- 漏洞发现和利用从 `priority=high` 打起。优先级为空时，先回报指挥补一轮评估。
- 删掉没有调用的代码。设置页里过期的 `legacyApplyPath(...)` 调用改为 `applyPathOp`。

## English

- **1.1.64**.
- Eight red-team flow fixes. Role prompts seed **new** engagements only; sync agents on an existing engagement to pick them up.
- The internal role is a leaf and does collect, assess, scan, and exploit itself.
- A release without a key drops only the oldest reservation. Ending a subagent auto-releases; a manual release must carry the acquire key.
- Preflight `include` checks only the named skills. Broken items include fixes for the user to run.
- IPv6 scoring needs at least two colons, so `dc01:389` is no longer ×3. Scoring lives only in `score-rules.js`.
- Attack-chain scoring skips disabled score points.
- `.env` accepts `export KEY=value` and strips unquoted inline comments. A `#` inside quotes stays.
- Internal score codes match the live list (`central-system`, `boundary-logical`, `boundary-strong`, and the rest), taken from `redteam_score_list`.
- Vuln-scan and exploit start at `priority=high`. If priority is empty, report back and run another assess first.
- Unused code removed. Stale settings calls to `legacyApplyPath` now call `applyPathOp`.

# 1.1.63

## 中文

- 版本 **1.1.63**。
- 官方更新脚本去掉中文注释，避免 `official update script is not ASCII`。

## English

- **1.1.63**.
- Official update script is ASCII only, so the handoff no longer fails the ASCII check.

# 1.1.62

## 中文

- 版本 **1.1.62**。
- 继续/重试重新打开。
- 锚点门：首轮输出上限 1024→8192，最多 2 步；已调工具即放开，英文思考过不了 we 锚也不再卡住。
- 已有预设的锚点配置与包内不一致时同步，不整份覆盖。

## English

- **1.1.62**.
- Continue/retry is on again.
- Anchor gate: bootstrap cap 8192, max 2 steps; promote after the first tool call.
- Existing presets sync the anchor-gate block when it differs from the package.

# 1.1.61

## 中文

- 版本 **1.1.61**。
- **多宿主 Apply**：npm-global 与桌面 `resources/app` 一并补丁（#72 类路径问题）。
- **#73**：代理 / IP / DNS 等 benign 话题不再误触攻击闸门（`net-scope.js`）。
- **#74**：自定义提示词持久化——`resolveInjectText` 读 `prompt-inject.md`，UI 保存走 `saveOverrideContent`，启动 `ensureOperatorBody`。
- **极简**：#80 保持官方 persistent-shell；UI 选 minimal 以 `agent-preset/selected` 为准（不再被会话头 `standard` 误导）；`adaptInjectForMinimalPreset` 对齐 shell-only 工具表。
- **拒答续跑**：`refusal-recover` 识别「我不做 / 不参与」等句式。
- 注入链：`injectMatchers` 防重复段；默认提示词重加密进 `asset-table.js`。

## English

- **1.1.61**.
- **Multi-host Apply**: patch npm-global and desktop `resources/app` together.
- **#73**: Benign proxy/IP/DNS topics no longer trip the attack gate.
- **#74**: Custom prompt persists via `prompt-inject.md` + `saveOverrideContent`.
- **Minimal**: #80 official shell-only preset; preset from `agent-preset/selected`; runtime `adaptInjectForMinimalPreset`.
- **Refusal recover**: broader Chinese refusal phrasing.
- Inject assembly dedupe; default prompt re-sealed.

# 1.1.60

## 中文

- 版本 **1.1.60**。
- **极简 / PTC**：与标准同一任务却被拦，多半是 preset 里 `run_code`、沙箱、plan 文案未洗净，或内置 minimal 缺 `agent-instructions`。本版反转 #60/#61/#63，minimal 补插件（#26）。**完全退出 → 应用 → 重启 → 新开对话** 后再测。
- **回退 → 重新发送**：「回退一次 / 回退上一轮」留在当前对话；已发送句回到输入框，本轮助手输出与 todo 撤掉。**1.1.60** 起按**当前轮**定位，多轮后不会又退到第一条用户消息（#74/#75 + `lib/rewind.js`）。
- **应用 / 重启**：用户点应用、重启时写入 client 包，避免误报「清洗没有完成，已取消重启」。
- 默认提示词从 `default-prompt-inject.md` **重新加密**进 `asset-table.js`；运行时只读加密槽。
- **#66** Windows `app.asar` 无 JScript 时 PowerShell 换包；**#67** `dsh.cmd` 解包路径；**#69** 演练台 `position:fixed`；**#71** assemble 守卫幂等；**#70** 技能路径按本机 OS 判定；**#68** 文档改为 `desktop` profile + `.tar.gz`（Hub 一键仍走 git，见 README）。

## English

- **1.1.60**.
- **Minimal / PTC**: Same task blocked while standard works → uncleared `run_code`, sandbox, or plan text, or minimal preset missing `agent-instructions`. This release flips #60/#61/#63 and adds the plugin on minimal (#26). **Quit fully → Apply → Restart → new chat** before retesting.
- **Rewind → resend**: Rewind buttons stay in the same chat; your last user line returns to the composer and this round’s assistant output/todos drop. From **1.1.60**, bounds follow the **current turn**, not the first user message (#74/#75 + `lib/rewind.js`).
- **Apply / restart**: User Apply/Restart writes client bundles so restart is not cancelled as “clean incomplete”.
- Default prompt **re-sealed** into `asset-table.js`; runtime reads the encrypted slot only.
- **#66** asar swap PS fallback; **#67** `dsh.cmd`; **#69** dock fixed; **#71** idempotent assemble guard; **#70** skill paths per host OS; **#68** docs: `desktop` + `.tar.gz` (Hub one-click still git — see README).

# 1.1.59

## 中文

- 版本升级到 1.1.59。
- 点应用后不再因为宿主路径或旧标记对不上，就报「清洗没有写进当前宿主」（#65）。
- `resources\app\node_modules` 和 `resources\app\dsh\node_modules` 都认。原文里已经没有官方身份句、也没有丢掉注入的写法时，不再要求那两条标记。
- complete 段补丁同时认 tab 和空格。

## English

- Version 1.1.59.
- Apply no longer reports that the clean missed the current host just because the package path or the old markers do not match (#65).
- Both `resources/app/node_modules` and `resources/app/dsh/node_modules` count. If the official identity sentence and the inject-dropping return are already gone, those two markers are not required.
- The complete-prompt patch matches both tab and space indentation.

# 1.1.58

## 中文

- 版本升级到 1.1.58。
- 打开、应用、重启都会挂上提示词。磁盘上有正文就用磁盘，没有就用规则集，再没有就用内置默认，不用再点保存。
- 启动不再在页面发出之后改写前端 client.js，避免输入框因模块版本号对不上而消失（#63）。
- macOS / Linux 已解包桌面端点应用后会退出并重新打开；清洗标记两种写法都认（#64）。

## English

- Version 1.1.58.
- Open, Apply, and restart all hang the prompt. A saved file wins, then the active rule set, then the built-in default. Save is not required.
- Startup no longer rewrites frontend client.js after the page has taken a module revision, so the composer does not disappear (#63).
- Unpacked macOS and Linux desktop builds quit and relaunch after Apply. Both inject markers count as clean (#64).

# 1.1.57

## 中文

- 版本升级到 1.1.57。
- 应用并重启后，设置框里的提示词直接挂到系统段；框空则用当前规则集。两者都空就停下来要求输入。
- 创造、PTC、极简、unrestricted、梁神与标准模式一样清掉拦截和禁止，并保住各自的工具流程。
- 演练授权按本机目录保存，更新后不用重授权；卸载成功后才清掉。空的环境初始化不再当成已配置。
- 官方 Messages 请求的 system 字段改用当前系统提示，不再钉住第一条。

## English

- Version 1.1.57.
- After Apply and restart, the settings-box prompt is hung on the system section. An empty box uses the active rule set. If both are empty, Apply stops and asks for a prompt.
- Cordis, PTC, minimal, unrestricted, and Liangshen clear intercepts and bans the same way standard does, and keep their own tools.
- Drill authorization is stored in this install and survives updates. It is cleared only after uninstall succeeds. An empty environment init is no longer treated as configured.
- The official Messages request system field uses the current system prompt instead of the first snapshot.

# 1.1.56

## 中文

- 版本升级到 1.1.56。
- 应用按设置框、当前规则集、官方系统提示词的顺序选用。空框且没有规则时停下来要求输入，不再把内置默认写进磁盘。
- 清洗和演练台跟随 DSH 主题的透明玻璃，去掉手动换色。
- 说明只保留官方 Web 和官方桌面。

## English

- Version 1.1.56.
- Apply uses the settings box, then the active rule set, then the official system prompt. An empty box with no rules asks for a prompt and does not write the built-in default to disk.
- 清洗 and the drill console use transparent glass that follows the DSH theme. The manual theme switch is gone.
- Docs keep official Web and the official desktop only.

# 1.1.55

## 中文

- 版本升级到 1.1.55。
- 点「应用」并重启后，每一轮 assemble 都会把提示词补回最前；宿主换成新 assemble 也会再包一次，不会第二轮丢掉。
- 空框不再在前端误取消应用；重启前先落下默认提示词。密封 asar 不会因为当前进程还是旧包而取消重启。
- 第二次应用不会因为冷却把重启/注入当成取消；密封包在换掉之前每次应用都会重启一次，补丁写完后不再空转。

## English

- Version 1.1.55.
- After Apply + restart, every assemble turn puts the operator prompt back at the front. If the host replaces assemble, it is wrapped again so turn 2 does not drop the inject.
- An empty settings box no longer cancels Apply on the client; Restart seeds the default prompt first. A sealed asar no longer cancels restart just because the running process still has the old archive.
- A second Apply is not treated as a cancel because of settle cooldown. A sealed archive still restarts on each Apply until swapped; after patches are in, it does not loop.

# 1.1.54

## 中文

- 版本升级到 1.1.54。
- 官方桌面密封 asar 启动不再中途解包/杀进程：避开 Host Fiber._reload 的 INACTIVE_EFFECT / DesktopHostFatalError；补丁留给设置页「应用」。
- 桌面 settle 延后并在 context 停用时退出；启动自愈只写盘、不 scheduleRestart（#59 / #60 / #61）。
- 市场 tar 安装与空 sha / 缺 installed-rev 的无限重启修复仍在（#58–#61，1.1.53）。

## English

- Version 1.1.54.
- Official desktop no longer unpacks or kills the host mid-boot on a sealed asar; that raced Fiber._reload and threw INACTIVE_EFFECT / DesktopHostFatalError. Patches wait for Settings Apply.
- Desktop settle is delayed and aborts on an inactive context; startup self-heal writes files only and does not scheduleRestart (#59 / #60 / #61).
- Marketplace tarball install and empty-sha / missing installed-rev restart loops remain fixed (#58–#61, 1.1.53).

# 1.1.53

## 中文

- 版本升级到 1.1.53。
- 修复点「应用」后无限重启（#59 / #60 / #61）：tarball 安装没有 `installed-rev`、或 `applied.json` 空 sha 时，启动不再反复 reapply+restart；对齐后不再空转重启，并加冷却。
- web 自愈重启不再自动弹浏览器，关窗后不会再被反复拉起新窗口（#59 / #61）。
- 空 sha 只在非密封、且清洗标记还在（或找不到插件根）时补戳，避免冲掉密封宿主自愈（#56 / #57）。
- 市场安装：`package.json` 标明优先 tar.gz/zip，避免 Hub 退回 `git ls-remote` 失败（#58）。

## English

- Version 1.1.53.
- Stop Apply/startup infinite restart (#59 / #60 / #61): missing `installed-rev` after tarball install or empty `applied.json` sha no longer reapply+restart every boot; skip restart once aligned, with a cooldown.
- Web self-heal restart does not open a browser, so closing the window no longer respawns tabs (#59 / #61).
- Empty-sha heal only runs when the host is not sealed and markers are present (or the plugin root is missing), so sealed-host self-heal still works (#56 / #57).
- Marketplace install prefers tar.gz/zip in `package.json` so Hub does not fall back to a failing `git ls-remote` (#58).

# 1.1.52

## 中文

- 版本升级到 1.1.52。
- 官方桌面「应用/重启」不再自动跑官方 installer（#57）：宿主版本由用户自行升级；插件只解包打补丁，避免落盘前误判失败清掉 `resources\\app`。
- 有 `applied.json` 但宿主又回到 sealed / 找不到插件根时，判定未对齐并自愈重打；面板提示「补丁已丢失，请重新应用」。
- 插件启动路径永不自动更新，仅面板手动更新。
- 默认提示词按本地 `default-prompt-inject.md` 重新加密写入 `asset-table.js`。
- 用户自改提示词不会被「应用」盖回加密默认：磁盘正文与内置不同时一律保留；运行时内置默认只读加密槽。
- 回退切点扩到整轮并在替换后清空 derive 缓存，避免下次发送仍带上被撤掉的内容。

## English

- Version 1.1.52.
- Official desktop Apply/Restart no longer auto-runs the official installer (#57); users upgrade the host themselves; the plugin only unpacks and patches.
- If `applied.json` exists but the host is sealed again / plugin root is missing, treat as mismatched and reapply; UI shows patches-lost.
- Plugin startup never auto-updates; update only from the panel.
- Reseal the default prompt from local `default-prompt-inject.md` into `asset-table.js`.
- Keep user-replaced prompts: never overwrite disk text that differs from the bundled sealed default; runtime bundled default comes only from the sealed slot.
- Rewind cuts the whole last turn and invalidates derive cache so the next send does not keep undone content.

# 1.1.51

## 中文

- 版本升级到 1.1.51。
- 修复 `/skills import` 对 `$DSH_HOME/skills` 自身导入时先删后拷把技能删空（#54）。
- 补齐 `platformEnvAdaptStatus` / `platformEnvAdaptSkip`，发送门禁不再误报「环境还没配好」（#55）。
- 修复官方桌面：无版本/同版本 `installer.exe` 被当成待更新劫持重启；更新失败时恢复 `resources/app`；空 sha 的 applied stamp 不再跳过 reapply（#56，0.1.7/0.2 同路径）。
- 补丁 #52 兼容无 `.volatile()` 写法；#57 跟到 `useDeveloperRole` 并覆盖 responses 通路；#48 上游已删句按软完成；状态导出 `patches_ready`；桌面端 shim 显示「本端不需要」。

## English

- Version 1.1.51.
- Reject `/skills import` when source overlaps `$DSH_HOME/skills` so delete-then-copy cannot wipe skills (#54).
- Implement `platformEnvAdaptStatus` / `platformEnvAdaptSkip` so the send gate no longer false-blocks ready environments (#55).
- Official desktop: ignore unversioned/same-version `installer.exe` pending updates; restore `resources/app` if update handoff fails; empty applied stamp sha no longer skips reapply (#56, same path on 0.1.7 and 0.2).
- Patch #52 matches non-`.volatile()` defaults; #57 follows `useDeveloperRole` and covers responses; #48 soft-settles when upstream removed the caution text; export `patches_ready`; desktop shim shows not-needed-here.

# 1.1.50

## 中文

- 版本升级到 1.1.50。
- 修复 macOS 官方桌面：点「应用」假失败「失败: 正在重启。」、解包后 `dsh` CLI 失效、status 误标 ✗（#53）。
- 修复点「应用」重启后默认提示词不注入：未改过时自动落盘内置默认，不必先点保存。

## English

- Version 1.1.50.
- Fix macOS official desktop: Apply false "Failed: Restarting.", broken `dsh` CLI after asar unpack, and status ✗ false negatives (#53).
- Fix default prompt not injecting after Apply + restart; bundled default is written without requiring Save first.

# 1.1.49-beta.1

## 中文

- 版本升级到 1.1.49-beta.1（#53 测试版）。
- 修复 macOS 官方桌面点「应用」后假失败「失败: 正在重启。」：`scheduleRestart` helper/runtime 分支补回 `restarting: true`；Darwin 重启改为 osascript 优雅退出 + SIGTERM/SIGKILL，排除 CLI 进程后再 `open` 重开（剥掉 ELECTRON_RUN_AS_NODE）。
- 解包 app.asar 后自动修补官方 `dsh` CLI 入口（asar/`app/` 回退）并补 `app/runtime -> ../runtime`，避免 `dsh web` 等全部 MODULE_NOT_FOUND。
- `/purge status` 对多路径文件清单按数组逐项判断，不再把已打补丁文件标成 ✗。
- 前端重启失败文案不再把成功分支的 note 当成 error。

## English

- Version 1.1.49-beta.1 (prerelease for #53).
- Fix macOS official desktop Apply false failure "Failed: Restarting.": helper/runtime branches of scheduleRestart return restarting:true; Darwin restart uses osascript quit then SIGTERM/SIGKILL, skips CLI processes, relaunches via open without ELECTRON_RUN_AS_NODE.
- After unpacking app.asar, auto-patch the official dsh CLI entry (asar/app fallback) and add app/runtime -> ../runtime so dsh web and other subcommands keep working.
- /purge status treats multi-path file lists correctly instead of marking patched files as missing.
- Restart failure UI no longer uses the success note as the error detail.

# 1.1.48

## 中文

- 版本升级到 1.1.48。
- 修复红队指挥「只派活」约束被组装时误删，导致不派 subagent；预设在 Agent Teams 下强制重开 classic subagent。
- 增加按任务选用 skill/MCP 的协议（先读目录，再按任务调用；子代理与红队同样）；不改官方注册与工具面。
- 子代理 maxDepth 适配 0.2 无 default 的 schema，补回默认 10。

## English

- Version 1.1.48.
- Fix redteam lead dispatch-only SOP being stripped during assemble; re-enable classic subagent under Agent Teams in the redteam preset.
- Add task-matched skill/MCP selection protocol (read catalog, then call what the task needs; same for subagents and redteam). Does not change official registration.
- Raise subagent maxDepth default to 10 on 0.2 schemas that dropped .default().

# 1.1.47

## 中文

- 版本升级到 1.1.47。
- 演练台「环境适配」接通 `platformConfigGet` / `Save` / `AssignToolkit`，修复 `unknown op: platformConfigGet`，工具路径与 FOFA/VPS 配置可正常读写。
- 技能库目录探测增加 `$DSH_HOME/redteam/skills`，Windows 用 `homedir()` 回退，不再只信空的 `HOME`。
- 知识库优先使用环境适配里的 nuclei 模板路径；空库时显示本机 `knowledge.db` 路径，避免误判成接口挂了。
- 首次安装弹出用户须知：说明用途、免费开源、GitHub 仓库地址；声明背着作者营利将追究法律责任，并提示禁止违法用途。确认后本机不再弹出。
- 桌面定位与表面检测放宽，安装目录名含 `DeepseekHarnessDesktop` 等也能找到本机 Harness；失败的定位缓存不再一直卡住「还没定位」。
- 回退与请求路径小修，降低后轮卡住或假进度的情况。

## English

- Version 1.1.47.
- Wire drill Env adapt ops `platformConfigGet` / `Save` / `AssignToolkit`, fixing `unknown op: platformConfigGet` so tool paths and FOFA/VPS config work again.
- Skill catalog also probes `$DSH_HOME/redteam/skills` and falls back with `homedir()` on Windows when `HOME` is empty.
- Knowledge prefers nuclei templates from Env adapt; empty libraries show the local `knowledge.db` path so a missing API is not assumed.
- First install shows a user notice: what the plugin does, that it is free/open source, the GitHub repo URL, legal warning against profit behind the author, and illegal-use prohibitions. After confirm it does not show again on that machine.
- Broader desktop locate/surface detection (including `DeepseekHarnessDesktop` installs); failed locate caches no longer stick on "host not located".
- Small rewind/request-path fixes to reduce later-turn hangs and misleading progress.

# 1.1.46

## 涓枃

- 鐗堟湰鍗囩骇鍒?1.1.46銆?.1.45 鏈夐棶棰橈紝鐣ヨ繃锛屼笉瑕佸畨瑁呫€?- 榛樿鎻愮ず璇嶆寜 `default-prompt-inject.md` 閲嶆柊鍔犲瘑鍐欏叆銆?- 淇娉ㄥ叆涓嶇ǔ瀹氾細绗簩杞垨浠诲姟鍋氬埌涓€鍗婁汉璁惧け鏁堛€佽褰撴垚 `project_instructions` 鎷嗘帀鐨勯棶棰樸€?- 宸ヤ綔鍖烘浛鎹㈢鍜屼綔鐢ㄥ煙璇存槑鏀瑰洖 0.1.7 鐨勪紭鍏堢骇锛氫笉鑳藉帇杩?system銆乨eveloper 鍜岀敤鎴峰師璇濄€備富 intro 鐨勫弽杞嫆缁濆彞淇濇寔涓嶅彉銆傚凡缁忓彔涓婄殑浣滅敤鍩熷己鍙ユ暣娈垫敹鎴愯繖涓€鍙ャ€?- 杩涙ā鍨嬪墠鍓ユ帀澶栧眰 ChatML / `<project_instructions>` 澹筹紝閬垮厤妯″瀷鎶婄湡瀹?system 娉ㄥ叆褰撴垚椤圭洰璇存槑銆?- 缁勮鍚庣殑绯荤粺鎻愮ず娈电粺涓€淇濊瘉 `text` 涓哄瓧绗︿覆锛涗笉鍐嶄細璇濋拤姝绘暣娈?sections锛岄伩鍏嶇浜岃疆 `renderPrompt` 璇?`undefined.length` 鐩存帴姝绘帀骞舵姤 `(gateway/internal)`銆?- `agent/pre-step` 濮嬬粓鎶?`decision.messages` 瑙勮寖鎴愭暟缁勶紝閬垮厤绗簩杞彂閫佹椂璇荤┖ messages 鐐告帀銆?- 鍦板尯闂搁棬锛氬鍦板潃鍩熷悕涓嶈兘鍙洜鍏朵腑涓€涓В鏋愬埌鍙楁帶鍦板尯灏辨暣绔欐嫤姝伙紙CDN/澶氱嚎鍣０ IP锛夈€?- 鍥為€€鍚?`deriveMessages` / `systemNodes` 瀵圭己 `content` 鍋氬厹搴曪紝閬垮厤鍥為€€鍐嶅彂閫佹椂 `(gateway/internal)`銆?- 娓呮礂杩涘害锛氭湭瀹氫綅瀹夸富鏃朵笉鍐嶆樉绀哄悡浜虹殑 `0/63`锛涙湰鏈轰笉闇€瑕佹垨缁勪欢鏈鐨勯」璁″叆宸插氨缁紝閬垮厤鍋囩殑 `48/63`銆?- 鐐广€屽簲鐢ㄣ€嶅氨浼氬啓鍏ラ粯璁ゆ彁绀鸿瘝骞舵敞鍏ワ紝妗嗙┖鏃剁敤鍐呯疆榛樿锛屼笉蹇呭厛鐐逛繚瀛樸€?- 淇鍥為€€锛歚snapshotEvents()` 涓虹┖鏃朵笉鍐嶈 `undefined.length`锛岄伩鍏?`(gateway/internal)` 鎶ラ敊瀵艰嚧鍥為€€鏃犳晥銆?
## English

- Version 1.1.46. Skip 1.1.45; that version has bugs. Do not install it.
- Reseal the default prompt from `default-prompt-inject.md`.
- Fix unstable inject: persona dropping on the second turn or mid-task, including cases where the model treated the system inject as `project_instructions` and rejected it.
- Replacement and scope workspace intros match 0.1.7 again: they do not override system, developer, or direct user instructions. The main intro anti-soft-refuse text stays. A stacked scope paragraph is collapsed back to that one sentence.
- Strip outer ChatML / `<project_instructions>` wrappers before the text reaches the model, so a real system inject is not read as project instructions.
- Sanitize assembled system-prompt sections so `text` is always a string; stop pinning full sections for a session, which could make the second turn crash in `renderPrompt` on `undefined.length` with `(gateway/internal)`.
- Always normalize `decision.messages` to an array in `agent/pre-step`, so a second send does not die on a missing messages list.
- Region gate: multi-address hosts are no longer blocked just because one resolved IP is in a controlled region (CDN/noise).
- After rewind, `deriveMessages` / `systemNodes` tolerate missing `content`, so resend no longer fails with `(gateway/internal)`.
- Clean progress: do not show a scary `0/63` before the host is located; items not needed on this install count as ready, so a fake `48/63` no longer appears.
- Apply writes and injects the default prompt; an empty box uses the bundled default, so a separate Save is not required.
- Fix rewind: empty `snapshotEvents()` no longer reads `undefined.length`, so undo no longer fails with `(gateway/internal)`.

# 1.1.44

## 涓枃

- 鐗堟湰鍗囩骇鍒?1.1.44銆?- 瀹樻柟妗岄潰瑙ｅ紑 `app.asar` 鏃跺厛鍐欏埌鏃佽竟鐨勭洰褰曪紝瑙ｅ紑瀹屾垚鎵嶆崲涓?`resources/app`銆傜洰褰曢噷宸茬粡鏈夊涓讳箣鍚庡彧鏀硅繖浜涙枃浠躲€傚悓涓€浠藉綊妗ｅ張鍑虹幇鏃跺彧鎶婂畠鎸紑銆傚綊妗ｇ殑澶у皬鎴栨椂闂村彉浜嗭紝鎴栫洰褰曚笉鍦ㄤ簡锛屾墠鍐嶈В涓€娆°€傝В鍖呭崱浣忔垨琛ヤ竵娌″啓瀹岋紝鎶婁笂涓€浠芥斁鍥炲幓锛屽崌绾ф爣璁扮暀鍒颁笅娆″啀璇曘€?- 鍥為€€涓婁竴杞彧鎾ゆ帀鏈€鍚庝竴鏉″凡缁忓彂鍑虹殑娑堟伅鍜屽畠鐨勫洖澶嶏紝鏇存棭鐨勮疆娆＄暀鍦ㄥ璇濋噷锛屼篃浠庢ā鍨嬭姹傞噷鎷挎帀銆傝繛缁洖閫€鍚庣暀涓嬬殑绌烘爣璁颁笉鍐嶈繘涓嬩竴杞姹傦紝涓嬩竴鍙ユ寜鏂版秷鎭彂銆?- 鍙紪杈戞彁绀鸿瘝鏁翠唤鏀惧湪绯荤粺鎻愮ず鏈€鍓嶏紝鍚屼竴浠芥鏂囦笉鍐嶆嫾绗簩閬嶃€傛瘡涓€姝ョ敤褰撳墠杩欎竴浠芥浛鎹㈢涓€鏉＄郴缁熸彁绀恒€?- deepseek.com 鐨勭郴缁熸彁绀哄浐瀹氳蛋 system锛屾€濈淮閾剧収鏃у彂閫併€?- 鍦板尯鎷︽埅鍙湅杩欐浠诲姟閲岀殑鐩爣銆傝嚜宸辩殑鏈嶅姟鍣ㄥ彧璁ゅ悕鍗曚笂鐨勯偅涓€涓湴鍧€鎴栦富鏈哄悕銆傜姝㈠彞鍐欎笂涔嬪悗鎵嶇粨鏉熻繖涓€杞€?- 瀹樻柟濮嬬粓鐢ㄥ甫 CTF 鐨勯粯璁ゆ彁绀鸿瘝銆傜孩闃熷紑浜嗚鍒欓泦灏卞彧鐢ㄨ鍒欓泦锛涘惁鍒欑敤鍘绘帀 CTF 鐨勯粯璁ゆ彁绀鸿瘝锛屽啀鎺ョ孩闃熸搷浣溿€傚瓙浠ｇ悊璺熶富浼氳瘽鍚冨悓涓€浠姐€傜鐩樻病鏈夋彁绀鸿瘝鏃跺惎鍔ㄥ氨鐢ㄩ粯璁ら偅浠斤紝涓嶅繀鍏堢偣淇濆瓨銆?
## English

- Version 1.1.44.
- Unpacking `app.asar` writes beside `resources/app` and swaps in only after the unpack finishes. Once that directory is usable, later starts only edit those files. The same archive showing up again is moved aside. A new size or mtime, or a missing directory, is unpacked once. If unpacking sticks or that patch round does not finish, the previous directory is put back and the upgrade marker stays for the next start.
- Rewinding the previous round removes only that sent message and its reply. Earlier rounds stay on screen and leave the next model request. Leftover rewind markers stay off the next model request, so the next send is a new message.
- The editable prompt is placed once at the front of the system prompt. Each step replaces the first system prompt with that current text.
- Instructions for deepseek.com stay on the system role. Thinking is still sent.
- The region check looks only at this task's target. An own server is allowed only when that exact address or hostname is on the list. The turn ends after the denial sentence is written.
- Official mode always uses the default prompt, including CTF. Red team uses only the active rule set, or the default prompt without CTF followed by the red team steps. Subagents receive the same inject as the main session. If the prompt file is empty, startup uses the bundled default without requiring Save.

# 1.1.43

## 涓枃

- 鐗堟湰鍗囩骇鍒?1.1.43銆?- 杩樻病瀹氫綅鍒版湰鏈?Harness 鏃讹紝涓嶅啀鎶婃瘡涓€鏉℃樉绀烘垚璺宠繃锛屽垎缁勮鏁颁篃涓嶅啀鎶婅烦杩囩畻鎴愬凡瀹屾垚銆?- 琛ヤ竵鍒楄〃琛ラ綈鍒板叏閮?52 鏉★紝鎬绘暟鍜屽垎缁勫寰椾笂銆?- 鍚姩鏃跺鏋滄殏鏃舵壘涓嶅埌瀹夸富鐩綍锛屼笉鍐嶆妸杩欎釜绌虹粨鏋滅紦瀛樹綇銆?
## English

- Version 1.1.43.
- Before this install is located, rows are no longer shown as skipped, and a skip no longer counts as done in the group total.
- The patch list now includes all 52 items, so the total matches the groups.
- A miss while looking up the host directory is not cached for the rest of the process.

# 1.1.42

## 涓枃

- 鐗堟湰鍗囩骇鍒?1.1.42銆?- 娓呮礂椤垫彁绀鸿瘝涓嬮潰鍙互鐧昏鑷繁鐨勬湇鍔″櫒锛氭瘡琛屼竴涓?IP 鎴栧畬鏁翠富鏈哄悕锛岀偣淇濆瓨鍚嶅崟銆傝鏄庨噷鍐欎簡姝ラ锛屽苟闄勪簡鎴浘銆?- 鏂板璇濇妸鎻愮ず璇嶆斁鍦ㄧ郴缁熸彁绀烘渶鍓嶃€傞潰鏉挎敼涓虹櫧澧ㄧ幓鐠冿紝涓ょ涓婚閮借兘鐪嬫竻瀛椼€?- 琛ヤ竵杩涘害鍙宸插簲鐢ㄧ殑椤广€傜綉椤佃韩浠介偅鏉″湪鍚庝竴鏉℃敼鍐欏彞瀛愪箣鍚庯紝浠嶆樉绀哄凡搴旂敤銆?- 琛ヤ笂 0.1.x 鐨勫叆鍙ｉ拡銆傚凡缁忔墦杩囩殑 0.2.0 涓嶄細琚噸鍐欍€?
## English

- Version 1.1.42.
- Under Prompt on the Clean page, register your own server: one IP or exact hostname per line, then Save list. The docs include the steps and a screenshot.
- New chats place the prompt at the front of the system prompt. The dock is frosted glass, and both the light and ink themes stay readable.
- The patch count includes only applied items. The web-surface identity row stays applied after the later sentence rewrite.
- Needles for 0.1.x entry points were added. An already patched 0.2.0 host is not rewritten.

# 1.1.41

## 涓枃

- 鐗堟湰鍗囩骇鍒?1.1.41銆?- 瀹樻柟妯″紡鍙敞鍏ュ綋鍓嶆彁绀鸿瘝锛涘惎鐢ㄨ鍒欓泦鍚庝互瑙勫垯闆嗕负涓汇€傜孩闃熷啀闄勪笂绾㈤槦鎿嶄綔瑕佹眰銆?- 鍥為€€鐣欏湪褰撳墠浼氳瘽锛氬厛閫夊洖閫€涓€娆℃垨涓婁竴杞紝涓婁竴鍙ユ斁鍥炶緭鍏ユ锛屽苟娓呮帀宸茬粡鍙戝嚭鍘荤殑鍐呭銆?- 瀹夸富娌℃竻娲楀畬锛屾垨娌℃湁鍙敞鍏ョ殑鎻愮ず璇嶆椂锛屼笉閲嶅惎銆?- 榛樿宸叉槸瀹屽叏鏉冮檺鏃讹紝鏂颁細璇濅笉鍐嶈閽夊洖鍙楅檺鏉冮檺銆傚畼鏂规ā鍨嬬殑 Session Log 涓婁紶榛樿鍏抽棴銆?- 鐩爣鍦板潃钀藉湪涓浗澶ч檰銆侀娓€佹境闂ㄦ椂鍋滄銆?
## English

- Version 1.1.41.
- Official modes inject the editable prompt, or the active rule set when one is enabled. Red team also keeps its operating section.
- Rewind stays on the current session: choose one step or the last round, return the last line to the composer, and clear what was already sent.
- Restart is cancelled unless the host is cleaned and inject text is present.
- A full-access default is no longer pinned back to a restricted preset. Official model Session Log upload is off by default.
- Targets whose addresses fall in mainland China, Hong Kong, or Macau are stopped.

# 1.1.40

## 涓枃

- 鐗堟湰鍗囩骇鍒?1.1.40銆?- 閫傞厤 **DSH 0.2.0-rc.2**锛欰nthropic OAuth 涓嶅啀鍦ㄧ郴缁熸彁绀烘渶鍓嶉潰寮烘彃銆孻ou are Claude Code鈥︺€嶏紝鑷畾涔?`prompt-inject` 涓嶄細琚帇鍒板悗闈€?- 鍘绘帀鍦?0.2 閲屽凡涓嶅瓨鍦ㄧ殑 **patch 41**锛坉eveloper 瑙掕壊鏀瑰啓锛夛紝閬垮厤鏃犳晥琛ヤ竵鍗犱綅銆?- 璁剧疆椤电偣 **搴旂敤** 鎴愬姛鍚?**鑷姩閲嶅惎** 瀹夸富锛屼笉蹇呭啀鎵撳紑鎻掍欢鐐圭浜屾閲嶅惎銆?
## English

- Version 1.1.40.
- For **DSH 0.2.0-rc.2**, Anthropic OAuth no longer prepends 鈥淵ou are Claude Code鈥︹€?ahead of your system prompt, so custom `prompt-inject` is not pushed behind a Claude identity block.
- Removed **patch 41** (developer-role remap) because those needles are gone in 0.2.
- After **Apply** in settings, the host **restarts automatically**; you no longer need to open the plugin again to confirm restart.

# 1.1.39

## 涓枃

- 鐗堟湰鍗囩骇鍒?1.1.39銆?- 涓枃 Windows 涓婏紝瀹樻柟妗岄潰鐗堢偣銆屽畨瑁呭苟閲嶅惎銆嶄笉鍐嶅仠鍦ㄣ€屾鍦ㄥ噯澶囬噸鍚€嶃€傛洿鏂拌剼鏈琛屾敼涓虹函 ASCII锛岃矾寰勯噷鐨勪腑鏂囧啓鎴?`\u` 杞箟锛岄伩鍏?Windows Script Host 鎸?GBK 鎶婃崲琛屽悶杩涙敞閲娿€?- macOS 鍜?Linux 涓嶈蛋杩欐潯鑴氭湰锛岄噸鍚柟寮忎笉鍙樸€?
## English

- Version 1.1.39.
- On Chinese Windows, the official desktop install-and-restart no longer stays on preparing to restart. The update script starts with an ASCII comment, and non-ASCII paths are written as `\u` escapes, so Windows Script Host does not swallow the newline when it reads the file as GBK.
- macOS and Linux do not use this script. Their restart path is unchanged.

# 1.1.38

## 涓枃

- 鐗堟湰鍗囩骇鍒?1.1.38銆?- 绾㈤槦涓嶅啀鏇跨敤鎴蜂笅杞藉伐鍏枫€傛病鏈夊畨瑁呰剼鏈椂锛屽紩瀵兼敼璧版紨缁冨彴銆岀幆澧冮€傞厤銆嶏紝鐢辩敤鎴疯嚜宸卞～璺緞銆?- 闀挎椂闂翠换鍔′細鍦ㄧ郴缁熸彁绀鸿瘝閲屾斁涓€寮犮€屾湰娆＄洰鏍囥€嶅崱銆傛寚鎸ュ拰瀛愪唬鐞嗙湅鐨勬槸鍚屼竴寮狅細鍙墦杩欎釜鍗曚綅锛屽洖鎶ラ噷甯﹀嚭鏉ョ殑鍏跺畠鍗曚綅涓嶆墦銆傚瓙浠ｇ悊鎸夎鑹蹭娇鐢ㄨ嚜宸辩殑鎻愮ず璇嶏紝娲炬椿鏃剁殑鍗曚綅鍚嶇О蹇呴』鍜岃繖寮犲崱涓€鑷淬€?- 宸ュ叿鏌ユ壘璁ゅ彂琛岀増涓婄殑鐪熷疄鏂囦欢鍚嶏紝渚嬪 Kali 鐨?`httpx-toolkit`銆乣impacket-secretsdump`锛屼笉鍐嶆妸 Python 鐨?`httpx` 褰撴垚鎵弿鍣ㄣ€?- 瀹樻柟妗岄潰鍦?macOS銆丩inux 涓婁篃鑳芥壘鍒?`app.asar`锛圡ac 鐢?`Contents/Resources`锛夈€俉indows 浠ュ涓嶅啀鍖呬竴灞備細鎶?`require` 寮勫潖鐨勬帶鍒跺彴闅愯棌銆?- 绾㈤槦鎺ュ叆閿氱偣闂細寮€澶村嚑姝ヨ緭鍑轰笂闄?1024锛涚涓€娈垫€濊€冮噷鏈?`we`銆佹病鏈?`let me` 灏辨斁寮€锛屽惁鍒欏悓涓€杞渶澶氬啀璧?4 姝ャ€備笂涓嬫枃鍘嬬缉鍚庡啀鍏充竴娆°€傜孩闃熷伐鍏峰拰浜鸿淇濇寔鍘熸牱銆?- 闅忓寘鎶€鑳藉悓姝ュ埌 `$DSH_HOME/redteam/skills`锛岄璁剧敤 `dshHomePath` 鎸囧悜瀹冿紝涓嶅啀鎶婃煇涓€鍙扮數鑴戠殑 `node_modules` 璺緞鍐欒繘棰勮銆備綘鑷繁鐨勬妧鑳戒粛鍦?`$DSH_HOME/skills`锛屽悓鍚嶄互浣犵殑涓哄噯銆?- 淇ソ绾㈤槦妯″紡涓嶆樉绀猴細澹版槑棰勮鏃舵紡浜嗚矾寰勫彉閲忥紝鎻掍欢涓€旈€€鍑猴紝妯″紡涓嬫媺灏辨病鏈夎繖涓€椤广€?- 璇存槑閲屽姞鍥炶禐鍔╁湴鍧€銆?
## English

- Version 1.1.38.
- Red team no longer downloads tools for you. When the setup script is missing, the guide points at the drill console environment page so you fill in the paths.
- Long jobs keep a target card in the system prompt. The commander and subagents see the same card: stay on that organization, and do not switch to other names that show up in results. Each subagent loads its own role text, and dispatched work must use the name on the card.
- Tool lookup accepts distro filenames such as Kali's `httpx-toolkit` and `impacket-secretsdump`, and does not treat Python's `httpx` as the scanner.
- The official desktop app can find `app.asar` on macOS and Linux (`Contents/Resources` on Mac). Outside Windows, the console-hide wrapper that broke `require` is not installed.
- Red team uses an anchor gate: the first steps are capped at 1024 output tokens, the cap lifts when the first reasoning block contains `we` and not `let me`, otherwise it lasts at most 4 steps in that turn, and a context compaction closes the gate again. Red team tools and the persona stay as they are.
- Bundled skills are copied to `$DSH_HOME/redteam/skills` and the preset points there with `dshHomePath`, instead of a machine-specific `node_modules` path. Your own skills stay in `$DSH_HOME/skills` and win on the same name.
- Red team mode shows in the mode list again. Declaring the preset no longer exits early because a path variable was missing.
- The sponsor addresses are back in the readme.

# 1.1.37

## 涓枃

- 鐗堟湰鍗囩骇鍒?1.1.37銆?- 淇敼婕旂ず鍙扮幆澧冮厤缃粴鍔ㄩ棶棰樸€?
## English

- Version 1.1.37.
- The drill console environment page scrolls, so the rest of the settings can be filled in.

# 1.1.36

## 涓枃

- 鐗堟湰鍗囩骇鍒?1.1.36銆?- 瑙ｅ喅绾㈤槦妯″紡鎷掔粷闂銆?
## English

- Version 1.1.36.
- Fix red team mode refusing the cleaned prompt.

# 1.1.35

## 涓枃

- 鐗堟湰鍗囩骇鍒?1.1.35銆?- 鍚姩鏃朵笉鍐嶈嚜鍔ㄦ洿鏂帮紝瑕佽嚜宸卞湪闈㈡澘閲岄€夋嫨銆?- dsh-purge 鍏ュ彛鏀瑰埌銆屼笂涓嬫枃銆嶆梺杈癸紝涓嶅啀鎸′綇鍒殑鎻掍欢鎸夐挳銆?- 寰楀垎鍙ｅ緞瀵归綈涓婃父锛?5 椤癸紝Web 搴旂敤澧炲姞鍏滃簳褰掔被銆?- 鐭ヨ瘑搴?14 绫昏鏁板寘鍚湰鏈?nuclei 妯℃澘锛岀偣鏌愪竴绫诲彲浠ョ瓫閫夈€?- 鎶€鑳借矾寰勮窡闅?`$DSH_HOME`锛屼笉鍐嶅洜涓虹ず渚嬭矾寰勫湪鏈満涓嶅瓨鍦ㄥ氨鎶婃暣鏉℃妧鑳芥爣鎴愪笉鍙敤銆?
## English

- Version 1.1.35.
- Startup no longer auto-updates; choose the update in the panel.
- The dsh-purge entry sits beside Context, so it no longer covers other plugin buttons.
- Scoring matches upstream: 25 items, with a fallback bucket for other web apps.
- The 14 knowledge categories count local nuclei templates, and a category filters the list.
- Skill paths follow `$DSH_HOME`. A skill is no longer marked unavailable just because an example path is missing on this machine.

# 1.1.34

## 涓枃

- 鐗堟湰鍗囩骇鍒?1.1.34銆?- **婕旂粌鍙扮煡璇嗗簱鐩存帴鍒楀嚭鏈満妯℃澘**銆傛墦寮€銆岀煡璇嗗簱 路 POC / EXP銆嶅氨鑳界湅鍒颁竴椤?nuclei 妯℃澘锛屽苟鍙互缈婚〉銆佹寜 CVE 鎴栫粍浠舵悳绱€備笉鍐嶅彧鏄剧ず銆屾湰鏈烘ā鏉?N銆嶃€佷笅闈㈡槸绌虹殑銆?- **鏇存柊鍖呭湪 Windows銆乵acOS銆丩inux 涓婇兘鑳借В鍘?*銆侺inux 涓嶅啀璋冪敤 PowerShell銆傞『搴忔槸锛歐indows 鐢?tar锛屼笉琛屽啀鐢?PowerShell锛沵acOS 鍜?Linux 鐢?tar銆乽nzip銆乸ython3銆乥sdtar銆傝繖浜涢兘娌℃湁鏃讹紝鐢?Node 鑷繁瑙?zip銆傛劅璋?@cracer4869 鍦?#44 鎶ュ嚭 Kali 涓婄殑 `spawnSync powershell ENOENT`銆?
## English

- Version 1.1.34.
- **The drill knowledge page lists local templates.** Opening Knowledge shows a page of nuclei templates, with paging and search by CVE or component. It no longer shows only the template count.
- **Update archives extract on Windows, macOS, and Linux.** Linux does not call PowerShell. Windows tries tar, then PowerShell. macOS and Linux try tar, unzip, python3, then bsdtar. If none of those exist, Node extracts the zip itself. Thanks to @cracer4869 for reporting `spawnSync powershell ENOENT` on Kali in #44.

# 1.1.33

## 涓枃

- 鐗堟湰鍗囩骇鍒?1.1.33銆?- **淇宸茬粡閲嶅惎鍚庯紝鎵撳紑闈㈡澘浠嶅脊鍑恒€岄渶瑕侀噸鍚€?*銆傚畼鏂瑰鎴风宸茬粡浠庤В寮€鐨?`resources/app` 杩愯鏃讹紝涓嶅啀浠呭洜涓哄綋鍓嶆槸瀹樻柟杩涚▼灏卞啀瑕佹眰閫€鍑轰竴娆°€傚彧鏈夎繖娆＄湡鐨勬尓寮€浜?`app.asar`锛屾墠浼氭彁绀洪噸鍚€?
## English

- Version 1.1.33.
- **Fix the restart dialog coming back after you already restarted.** When the official app is already running from the unpacked `resources/app`, opening the panel no longer asks you to quit again just because this is the official process. The restart prompt appears only when `app.asar` was actually moved aside in this run.

# 1.1.32

## 涓枃

- 鐗堟湰鍗囩骇鍒?1.1.32銆?- **鎸夋祴璇曠増鎺ヤ笂婕旂粌鍙板竷灞€**锛氶潰鏉垮彲鎷栧姩銆佸彲鏀瑰ぇ灏忥紝娴呰壊鍜屾繁鑹茶窡瀹夸富涓婚璧般€?- **璁剧疆椤典笉鍐嶅嚭鐜版湰鎻掍欢**銆備粠浼氳瘽鏍囬鏃佺殑 dsh-purge 鎵撳紑鍙充晶鏍忥紝娓呮礂鍜屾紨缁冨彴閮藉湪閲岄潰銆?
## English

- Version 1.1.32.
- **Bring the beta dock layout onto stable**: the panel can be dragged and resized, and light and dark follow the host theme.
- **The plugin no longer appears on the Settings page.** Open the right dock from dsh-purge beside the session title. Clean and Drill are both in that dock.

# 1.1.31

## 涓枃

- 鐗堟湰鍗囩骇鍒?1.1.31銆?- **婕旂粌鍙拌繘鍏ユ寮忕増**銆傚彸渚ф爮涓ら〉锛氭竻娲椼€佹紨缁冨彴銆傜涓€娆¤繘鍏ユ紨缁冨彴瑕佽澹版槑骞剁‘璁ゆ巿鏉冦€傝祫浜с€佹妧鑳藉拰鏈満鐜閮藉湪鏈彃浠堕噷锛屼笉鍐嶅崟鐙娴嬭瘯鐗堢孩闃熷寘銆?- **淇鍥為€€鍫嗗垎鏀?*锛氬涓讳笉鑳藉湪鍘熶細璇濋噷鎴柇锛屽洖閫€鍚庝細鎶婃棫浼氳瘽浠庝晶杈规爮绉诲嚭锛屽閫€鍑犳涓嶄細鐣欎笅涓€涓插垎鏀€?
## English

- Version 1.1.31.
- **Drill console is on the stable release.** The right dock has two pages: Clean and Drill. The first time you open Drill you read the notice and confirm authorization. Assets, skills, and the local environment ship inside this plugin.
- **Fix rewind leaving a branch every time.** The host cannot truncate a session in place. After rewind the old session leaves the sidebar, so repeated undo does not pile up branches.

# 1.1.30

## 涓枃

- 鐗堟湰鍗囩骇鍒?1.1.30銆?- **淇姝ｅ紡鐗堝拰 web 鍒囨崲鐗堟湰澶辫触**锛氫笉鍐嶇敤 `dsh plugin add` 鎷夊寘銆俻npm 璇锋眰 GitHub 鍘嬬缉鍖呬細 `http 302` 鎴?`fetch failed`銆傛敼鐢辨彃浠惰嚜宸变笅杞姐€?- **淇鎬濊€冨拰杈撳嚭姝诲惊鐜?*锛氬幓鎺夐粯璁ゆ彁绀鸿瘝閲屾病鏈夌粓姝㈡潯浠剁殑閲嶇疆銆?
## English

- Version 1.1.30.
- **Fix version switching on the desktop app and web**: stop installing through `dsh plugin add`. pnpm's fetch of the GitHub archive returns `http 302` or `fetch failed`. The plugin downloads the package itself.
- **Fix the thinking and output loop**: remove the default-prompt reset that had no stop condition.

# 1.1.28

## 涓枃

- **淇鏇存柊澶辫触 `http 302`**锛氫笅杞芥敼涓虹洿杩?`codeload.github.com`锛屽苟鎵嬪姩璺熼殢璺宠浆锛岄伩鍏?Electron/閮ㄥ垎 Node 瀵?github.com 鈫?codeload 鐨?302 澶勭悊澶辫触銆?- **淇娴嬭瘯鐗堝垪琛ㄧ┖鐧?*锛氬墠绔?`keepListedVersion` 涓庡悗绔竴鑷达紝姝ｅ紡鐗堝凡鍙戝竷鏃朵粛淇濈暀 beta tip / `beta` 鍒嗘敮锛泃ip SHA 鎷変笉鍒版椂鍥為€€ raw/jsDelivr 鎺㈡祴銆?
## English

- **Fix update failure `http 302`**: download via `codeload.github.com` and follow redirects manually so Electron/some Node builds no longer stall on github.com 鈫?codeload 302.
- **Fix empty beta list**: client `keepListedVersion` matches the server 鈥?keep the beta tip / `beta` branch after stable ships; fall back to raw/jsDelivr when tip SHA cannot be fetched.

# 1.1.27

## 涓枃

- **淇搴旂敤閲嶅惎鍚庤繘瑙勫垯璁惧畾浠嶅脊銆岄渶瑕侀噸鍚€?*锛氭墜鍔ㄣ€屽簲鐢ㄣ€嶆垚鍔熷悗鍐欏叆 `applied` 鎴筹紝閲嶅惎鍚?settle 涓嶅啀璇垽琛ヤ竵鏈榻愩€?- 鐐广€岄噸鍚€嶆竻鎺?`boot_full_quit` 绮樻€ф爣璁帮紱status 鎸夊竷灏斿€煎悓姝ュ脊绐椼€?- web `waitForRestart` 蹇呴』鍏堢湅鍒版棫杩涚▼鎺夌嚎鍐嶅垽瀹氭垚鍔燂紝閬垮厤鍚岃繘绋嬭鍒锋柊鍙堝脊绐椼€?
## English

- **Fix restart prompt still showing after Apply + successful restart**: write the `applied` stamp on successful manual Apply so settle does not think patches are out of date.
- Clear sticky `boot_full_quit` when Restart is clicked; status syncs the modal from the boolean.
- Web `waitForRestart` requires the old process to go down before treating restart as success, avoiding same-process false refresh.

# 1.1.26

## 涓枃

- **淇娴嬭瘯閫氶亾琚寮忕増鍚屽彿钘忔帀**锛歚1.1.25` 姝ｅ紡鍙戝竷鍚庯紝`1.1.25-beta.*` 鍥犮€屾寮忓凡杩戒笂銆嶉€昏緫鏁撮€氶亾涓嶅彲瑙侊紱鐜?**beta 鍒嗘敮 tip 濮嬬粓鍒楀嚭**锛堟寮?娴嬭瘯骞惰锛屾祴璇曞甫绾㈤槦锛夈€?- 宸茶拷涓婄殑鏃?beta **鏍囩**浠嶄細闅愯棌锛沗1.1.11-beta` 浠嶄笅绾裤€?
## English

- **Fix beta lane hidden by same-number stable**: after `1.1.25` stable, `1.1.25-beta.*` vanished via the 鈥渟table caught up鈥?filter; the **beta branch tip always stays listed** (parallel channels; beta carries red-team).
- Older caught-up beta **tags** still hide; `1.1.11-beta` stays withdrawn.
# 1.1.25

## 涓枃

- **淇 [#43](https://github.com/YuJunZhiXue/dsh-purge/issues/43)**锛氫笉鍐嶆妸 `profiles/*/cordis.patch.yml`锛堢敤鎴?patch 灞傦級绾冲叆 `backupAll`/`revertAll`锛涘崌绾ц嚜鎰堟椂涓嶄細鐢ㄦ棫 bak 瑕嗙洊鐢ㄦ埛鍚庢潵杩藉姞鐨?`insert`銆?- 鍚姩/杩樺師鏃朵富鍔ㄤ涪鎺夊巻鍙蹭笂璇缓鐨?`cordis.patch.yml.dshpurge.bak`锛屼繚鐣欏綋鍓嶇敤鎴锋枃浠躲€?- 鏂板 `npm run test:profile-patch`銆?
## English

- **Fix [#43](https://github.com/YuJunZhiXue/dsh-purge/issues/43)**: stop including `profiles/*/cordis.patch.yml` (user patch layer) in `backupAll`/`revertAll`, so upgrade reapply no longer restores an old bak over later user `insert`s.
- Drop stale `cordis.patch.yml.dshpurge.bak` without restoring; keep the live user file.
- Add `npm run test:profile-patch`.
# 1.1.24

## 涓枃

- **淇 [#40](https://github.com/YuJunZhiXue/dsh-purge/issues/40)**锛歚pathLooksDesktop` 涓嶅啀浠呭嚟璺緞閲岀殑 `deepseek-harness` 瀛愪覆鎶婃簮鐮佺増鍒ゆ垚妗岄潰绔紱闇€甯?`resources/` / `.exe` / `.app` 绛夊畨瑁呭舰鎬併€?- **淇 [#41](https://github.com/YuJunZhiXue/dsh-purge/issues/41)**锛氭簮鐮侀儴缃茬殑 `apps/cli`锛坱sdown 鏋勫缓浜х墿锛夌姝?hide-console 娉ㄥ叆锛沗revertAll` 鍦ㄦ棤 `.dshpurge.bak` 鏃跺彧璺宠繃銆佺粷涓嶅垹闄ょ洰鏍囨枃浠躲€?- 鏂板 `npm run test:surface` 鍥炲綊銆?
## English

- **Fix [#40](https://github.com/YuJunZhiXue/dsh-purge/issues/40)**: `pathLooksDesktop` no longer treats source trees as desktop just because the path contains `deepseek-harness`; require install shapes (`resources/`, `.exe`, `.app`).
- **Fix [#41](https://github.com/YuJunZhiXue/dsh-purge/issues/41)**: skip hide-console injection into source `apps/cli` build output; `revertAll` never deletes targets when `.dshpurge.bak` is missing.
- Add `npm run test:surface`.
# 1.1.23

## 涓枃

- **淇 [#38](https://github.com/YuJunZhiXue/dsh-purge/issues/38)**锛歚#1`/`#2`/`#3` 鎻愮ず璇嶈ˉ涓佹瘡娆?`apply` 鍙犲姞绾?+841 瀛楃銆佹案涓嶆敹鏁涖€?- **鍘熷洜**锛氭浛鎹骇鐗╀粛浠ュ墠涓€鐗堟枃鏈负鍓嶇紑锛屼笖鏈 `skipIfMarked`锛宍autoApplyOnStart` 姣忚疆閮戒細鍐嶅啓涓€灞傘€?- **淇**锛氫负 `#1`/`#2`/`#3` 琛?`skipIfMarked: true`锛圼#42](https://github.com/YuJunZhiXue/dsh-purge/pull/42)锛夛紝骞跺姞 `npm run test:idempotence` 鍥炲綊銆?- 宸茶啫鑳€鐨勫涓绘枃浠朵笉浼氳嚜鍔ㄧ缉鍥烇紝闇€杩樺師 `.dshpurge.bak` 鎴栭噸瑁?dsh 鍚庡啀 apply銆?
## English

- **Fix [#38](https://github.com/YuJunZhiXue/dsh-purge/issues/38)**: prompt patches `#1`/`#2`/`#3` grew by ~+841 chars on every `apply` and never converged.
- **Cause**: replacement text still starts with the previous pattern, and `skipIfMarked` was missing, so `autoApplyOnStart` rewrote every boot.
- **Fix**: set `skipIfMarked: true` on `#1`/`#2`/`#3` ([#42](https://github.com/YuJunZhiXue/dsh-purge/pull/42)); add `npm run test:idempotence`.
- Already-bloated host files are not auto-shrunk 鈥?restore `.dshpurge.bak` or reinstall dsh, then apply again.

# 1.1.22

## 涓枃

- **淇瀹樻柟妗岄潰鐐广€屽簲鐢ㄣ€嶆姤 ENOENT**銆俙app.asar` 杩樺湪鏃讹紝鏂板缓 `dsh-purge-child-process-hide.mjs` 浼氬け璐ワ紝璺緞琚啓鎴?`resources\app.asar\...\dsh-purge-child-process-hide.mjs`锛岃ˉ涓佸仠鍦ㄥ緟搴旂敤銆?- **鍘熷洜**锛氬畼鏂瑰鎴风杩樺甫鐫€ `app.asar` 鏃讹紝Electron 浼氭妸 `resources\app` 鏄犲皠杩涜繖涓綊妗ｃ€傚綊妗ｉ噷娌℃湁鐨勬柊鏂囦欢锛岀敤鏅€氭枃浠舵帴鍙ｅ幓鍒涘缓灏变細 ENOENT銆?- **涓ょ鍐欐硶閮戒繚鐣?*銆傚綊妗ｈ繕鍦ㄦ椂锛屾敼鍐欑湡瀹炵鐩樹笂鐨?`resources\app`銆傛病鏈?`app.asar` 鏃朵粛鐢ㄥ師鏉ョ殑 `node:fs`锛屽寘鎷?Web銆佺ぞ鍖烘闈紝浠ュ強瀹樻柟鍖呭凡缁忚В寮€骞舵妸褰掓。鎸垚 `app.asar.bak` 鐨勬儏鍐点€?- 瀹夎鐩綍涓嶅啓姝荤洏绗︺€俉eb 鍜岀ぞ鍖烘闈㈢殑搴旂敤銆侀噸鍚繚鎸佸師鏍枫€傚涓讳粛瀵瑰噯 **dsh 0.1.7-rc.2**銆?
## English

- **Fixes ENOENT when Apply runs on the official desktop.** While `app.asar` is still present, creating `dsh-purge-child-process-hide.mjs` failed. The path was rewritten to `resources\app.asar\...\dsh-purge-child-process-hide.mjs`, and patches stayed pending.
- **Cause**: with the archive still in place, Electron maps `resources\app` into `app.asar`. Creating a file that is not already in the archive through the normal file API throws ENOENT.
- **Both write paths stay.** If the archive is still there, files are written on the real `resources\app` directory. If there is no `app.asar`, the previous `node:fs` path is unchanged. That covers Web, community desktop, and an official install that has already been unpacked and had the archive moved to `app.asar.bak`.
- Install paths are not pinned to a drive letter. Web and community desktop keep their existing Apply and restart. The host target remains **dsh 0.1.7-rc.2**.

# 1.1.21

## 涓枃

- **淇蹇呴渶琛ヤ竵澶辫触 #43銆?9銆?15銆?23銆?42**銆傜偣銆屽簲鐢ㄣ€嶄笉鍐嶅洜涓鸿繖 5 鏉℃姤銆屾竻娲楁湭瀹屾垚銆嶃€傛彁绀鸿瘝鏈潵灏变細鍐欏叆锛涜繖 5 鏉℃病鍐欎笂鏃讹紝鐣岄潰鍗存妸鏁存搴旂敤鍒ゅけ璐ワ紝鐪嬭捣鏉ュ儚鎻掍欢澶辨晥銆?- **鍘熷洜**锛氫笂绾ф枃浠跺す鍚嶅彨 DeepSeek Harness 鏃讹紝鏁存５鐩綍琚綋鎴愬畼鏂规闈€俉eb 鐨?npm 鍖呭洜姝よ鎺掗櫎锛岃繖 5 鏉″寰椾笂鐨勫師鏂囦篃娌″啓杩涘幓銆傚畨瑁呰矾寰勪笉鍐欐鐩樼銆傜幇鍦ㄥ彧鏈夋梺杈圭湡鏈夋闈㈢▼搴忥紝鎴栬矾寰勫湪璇ュ畨瑁呯殑 `resources/app` 閲岋紝鎵嶇畻妗岄潰瀹夎銆俉eb銆佺ぞ鍖烘闈€佸畼鏂规闈㈠悇鑷墦鑷繁鐨勫寘銆?- **#43**锛氬幓鎺?Web 鍥涗釜鍐呯疆棰勮锛坰tandard銆乸tc銆乧ordis銆乵inimal锛夐噷鐨勮韩浠藉彞銆傛病鍐欎笂鏃讹紝棰勮閲岀殑鍘熻韩浠藉彞浼氱暀鍦ㄦ敞鍏ユ梺杈广€?- **#9**锛氬鎵硅姹傝嚜鍔ㄦ斁琛屻€?- **#15**锛氭矙绠?`confine` 涓嶅啀鍖呬竴灞傦紝鍛戒护鎸夊師鏍锋墽琛屻€?- **#23**锛氬瓙浠ｇ悊榛樿娣卞害浠?1 鎻愬埌 10銆?- **#42**锛氱粰璁剧疆鏈嶅姟琛ュ洖鏃х殑 `register` / `get`锛岃繕鍦ㄨ皟鏃ф帴鍙ｇ殑鎻掍欢鎵嶈兘鍔犺浇銆?- 鏂囦欢鍦ㄣ€佷絾杩欎唤鍘熸枃涓嶅湪褰撳墠鐗堟湰閲屾椂锛屾樉绀鸿烦杩囷紝涓嶅啀鎶婃暣娆″簲鐢ㄥ垽澶辫触銆傚師鏂囪繕鍦ㄦ椂浠嶄細鍐欎笂銆?
## English

- **Fixes required-patch failures #43, #9, #15, #23, and #42.** Apply no longer reports the cleanse as incomplete because of these five. The prompt was already written; the failure made the plugin look dead.
- **Cause**: a parent folder named DeepSeek Harness was treated as the official desktop install, so the Web npm packages were excluded and these five were never written. Install paths are not pinned to a drive letter. A tree counts as the desktop install only when the desktop executable is beside it, or the path is under that install's `resources/app`. Web, community desktop, and official desktop each patch their own packages.
- **#43**: strips the identity sentence from the four built-in Web presets (standard, ptc, cordis, minimal). Left in place, that sentence stays next to the inject.
- **#9**: approval requests are auto-granted.
- **#15**: sandbox `confine` no longer wraps the command.
- **#23**: subagent default depth moves from 1 to 10.
- **#42**: the settings service gets the old `register` / `get` methods back, so plugins that still call them can load.
- When the file exists but this version does not contain that original text, the row shows skipped and Apply still completes. Text that is present is still written.

# 1.1.20

## 涓枃

- **瀹夸富鐗堟湰**锛氬綋鍓嶅鍑?**dsh 0.1.7-rc.2**銆備笂涓€妗?**0.1.7-rc.1**锛堝惈 `0.1.7-rc.1.20260924.1`锛夌殑鏃ч敋鐐逛粛鍙敤銆?- **瀹樻柟妗岄潰鍗囩骇**锛氬凡缁忎笅杞界殑鏂扮増鏈細鍦ㄩ噸鍚紝鎴栧湪搴旂敤閲岀偣瀹夎骞堕噸鍚椂鐪熸瀹夎锛岀劧鍚庤В寮€鏂扮増鏈苟閲嶆柊鎵撹ˉ涓併€傛病鏈夋柊鐗堟湰鏃讹紝閲嶅惎浠嶆槸鍏虫帀鍐嶆墦寮€褰撳墠瀹㈡埛绔€傚畨瑁呯洰褰曚笉鍐欐鐩樼銆?- **琛ヤ竵**锛?14銆?35 璺熶笂 rc.2 鐨勫崌绾у啓娉曪紝涓嶅啀鎶ュ繀闇€琛ヤ竵澶辫触銆?29銆?33銆?36 鐨勬柊鎻愮ず鍙ヤ篃浼氭墦涓娿€?- Web 鍜岀ぞ鍖虹増 DSH Desktop 鐨勫簲鐢ㄣ€侀噸鍚繚鎸佸師鏍枫€?
## English

- **Host version**: current target is **dsh 0.1.7-rc.2**. Anchors for the previous target, **0.1.7-rc.1** (including `0.1.7-rc.1.20260924.1`), still match.
- **Official desktop upgrade**: a downloaded update installs on Restart, or on the in-app install-and-restart action, then the new build is unpacked and patched. With no pending update, Restart still closes and reopens the current client. Install paths are not pinned to a drive letter.
- **Patches**: #14 and #35 match the rc.2 escalation text, so Apply no longer fails those required patches. #29, #33, and #36 follow the new prompt wording.
- Web and community DSH Desktop keep their existing Apply and restart.

# 1.1.19

## 涓枃

- **瀹樻柟妗岄潰 EXE**锛氭敮鎸佸畼鏂?DeepSeek Harness銆傜偣銆屽簲鐢ㄣ€嶈В寮€ `app.asar` 骞惰ˉ涓婂師鐢熸ā鍧楋紝鍐嶇偣銆岄噸鍚€嶏紝瀹㈡埛绔嚜宸卞叧鎺夊苟閲嶆柊鎵撳紑銆俉eb 鍜岀ぞ鍖虹増 DSH Desktop 鐨勫簲鐢ㄣ€侀噸鍚繚鎸佸師鏍枫€?- **閲嶅惎**锛氬畼鏂瑰鎴风閫€鍑轰笉鍐嶈澶栧３褰撴垚宕╂簝锛屼篃涓嶄細鐣欎笅鍚庡彴 PowerShell銆傞噸鍚剼鏈笉鍐嶈皟鐢?Windows 鑴氭湰瀹夸富娌℃湁鐨?`toISOString`锛岄伩鍏嶅脊鍑鸿繍琛屾椂閿欒銆傛柊杩涚▼涓嶅啀缁ф壙 `ELECTRON_RUN_AS_NODE`锛屽惁鍒欎細鍒氭墦寮€灏遍€€鍑恒€?- **鏇存柊**锛氭崲鐗堟湰鎴栧洖閫€鏃讹紝鎸夎惤鍦扮殑閭ｄ竴鐗堣嚜鍔ㄨ繕鍘熷啀搴旂敤锛屼笉蹇呮瘡娆℃墜鍔ㄥ厛杩樺師鍐嶅簲鐢ㄥ啀閲嶅惎銆?- **琛ヤ竵鍒楄〃**锛氬涓诲凡缁忚嚜甯?`dsh-web-fetch-http` 鏃讹紝涓嶅啀鏄剧ず涓€鏉℃案杩滆烦杩囩殑 #20銆傚畨瑁呯洰褰曚笉鍐嶅啓姝荤洏绗︺€?
## English

- **Official desktop EXE**: Apply on official DeepSeek Harness unpacks `app.asar`, restores native modules, then Restart closes the client and opens it again. Web and community DSH Desktop keep their existing Apply and restart.
- **Restart**: exiting the official host is no longer treated as a crash, and no PowerShell process is left behind. The helper no longer calls `toISOString`, which made Windows Script Host pop a runtime error. The new process does not inherit `ELECTRON_RUN_AS_NODE`, which made it exit immediately.
- **Updates**: switching or rolling back a version restores and reapplies that version's patches without a manual revert first.
- **Patch list**: hosts that already depend on `dsh-web-fetch-http` no longer show a permanently skipped #20. Install paths are not pinned to a drive letter.

# 1.1.18

## 涓枃

- **閲嶅惎**锛氱偣銆岄噸鍚€嶅悗鏃ч〉闈㈢殑 token 浼氬け鏁堬紝鍙埛鏂扮瓑浜庢墦涓嶅紑銆傜幇鍦ㄤ細绛夌鍙ｉ噴鏀撅紙蹇呰鏃剁粨鏉熸棫杩涚▼锛夛紝骞舵寜鏂拌繘绋嬫墦鍗扮殑鍦板潃鎵撳紑娴忚鍣ㄣ€傝鐢ㄦ柊鎵撳紑鐨勯〉闈紝鍐嶆柊寮€涓€杞璇濄€?- **璁剧疆**锛?.1.17 涔嬪墠鑻ュ凡鎶?`legacyApplyPath` 鍙犺繘 `dsh-settings`锛岀偣銆屽簲鐢ㄣ€嶄細鏀舵垚涓€浠斤紝鎻愪緵鍟嗙洰褰曟墠鑳借捣鏉ャ€傛敹濂戒箣鍚庡啀閲嶅惎涓€娆°€?
## English

- **Restart**: the old page token dies with the process, so a refresh looks like restart did nothing. Restart now frees the port and opens the browser at the new `dsh web:` URL. Use that page and start a new chat.
- **Settings**: Apply collapses duplicate `legacyApplyPath` left by earlier 1.1.17 patches so `dsh-settings` can load. Restart once after that apply.

# 1.1.17

## 涓枃

- **绋冲畾鎬?*锛氫慨澶嶈缃ˉ涓?#42 鍦?dsh 0.1.7 涓婇噸澶嶆彃鍏?`legacyApplyPath` 鐨勯棶棰樸€傛鍓嶄細瀵艰嚧 `@deepseek-ai/dsh-settings` 鏃犳硶鍔犺浇銆佹彁渚涘晢鐩綍鎶ラ敊銆乵nemon 绛夋彃浠惰繛閿?pending銆傜幇鏀逛负 `skipIfMarked`锛屼笖涓嶅啀涓庡畼鏂瑰凡鑷甫鐨?`legacyApplyPath` 鍙犲啓銆?- **宸ヤ綔鍖哄己鎸囦护**锛?1/#2 鍚屾椂璇嗗埆 `WORKSPACE_*` 涓?`AGENT_*` 甯搁噺鍚嶏紝閬垮厤銆屽叏灞€/鏇挎崲寮忓厤璐ｃ€嶅湪鏃у涓讳笂鏄剧ず璺宠繃銆佸簲鐢ㄦ棤鏁堛€?- **鎷掔瓟涓庤蒋鎷?*锛氬畼鏂?`agent-instructions` 寮烘寚浠よˉ鍏呮湰鏈烘巿鏉冭瘎娴嬩笌鍙嶈蒋鎷掕瘽鏈紱鎻掍欢澧炲姞鍥哄畾 `dsh-purge:rules` 娈碉紙涓庢墽琛岃鍒欎竴鑷达級銆?*鏂板紑浼氳瘽骞堕噸鍚?dsh 鍚?*鐢熸晥銆?
## English

- **Stability**: patch #42 no longer stacks duplicate `legacyApplyPath` on dsh 0.1.7, which broke `@deepseek-ai/dsh-settings`, provider catalog loading, and downstream plugins. Uses `skipIfMarked` and does not re-insert the helper the official package already ships.
- **Workspace intros**: patches #1/#2 match both `WORKSPACE_*` and `AGENT_*` constant names so rows no longer show Skipped on older installs.
- **Refusal / soft refusal**: stronger official workspace intros plus a fixed `dsh-purge:rules` section. **Restart dsh and start a new chat** for prompt changes.

# 1.1.16

## 涓枃

- 瀵瑰噯 **dsh 0.1.7-rc.1**銆傚伐浣滃尯璇存槑甯搁噺鏀瑰悕涓?`AGENT_INSTRUCTIONS_INTRO`锛屽彞瀛愭病鍙橈紝琛ヤ竵璺熺潃鏀广€?- 娌欑 `confine()` 宸叉槸 `async confine(argv, policy, signal)`锛岃ˉ涓佹寜鏂板嚱鏁板啓銆傜洿閫氳涓轰笌涓婁竴鐗堢浉鍚屻€?- 瀛愪唬鐞嗘繁搴︽敼鍒?`dsh-subagent`锛岄粯璁や粠 1 鎻愬埌 10銆傛繁搴︽鏌ヨ繕鍦ㄣ€?- 璁剧疆鏈嶅姟琛ュ洖鏃х殑 `register` / `get`銆俙dsh-mnemon`銆乣dsh-better-reasoning-effort` 杩欑被杩樺湪璋冩棫鎺ュ彛鐨勬彃浠跺彲浠ョ户缁敤銆傚畼鏂?`describe` / `update` 涓嶅姩銆傝ˉ涓佸彧鎵撲竴娆★紝涓嶄細鍦ㄥ惎鍔ㄦ椂閲嶅鎻掑叆銆?- 鍒犳帀 0.1.7 閲屽凡缁忓涓嶄笂鐨勬棫鏉℃枃锛屽寘鎷崟鐙粰 `dsh-base` 琛?`dsh-web-fetch-http` 渚濊禆鐨勯偅鏉°€傚畼鏂瑰寘宸茬粡鑷甫銆?- Web 鍥涗釜鍐呯疆棰勮锛坰tandard銆乸tc銆乧ordis銆乵inimal锛夊彧娓呯┖韬唤鍙ャ€傚伐浣滅洰褰曘€佸伐鍏峰垪琛ㄣ€乣ptc` 妯″紡锛屼互鍙?minimal 鐨?`complete: true` 鍜?`includeRuntimeContext: false` 涓嶅姩銆?- `complete: true` 鏃讹紝`prompt-inject.md` 浠嶆帴鍦ㄨ繖娈靛墠闈€傛崲瀹夸富鐗堟湰鎴栨棫閽╁瓙鍒犳涔嬪悗锛屾敞鍏ヤ笉浼氫涪銆傜偣銆屽簲鐢ㄣ€嶄箣鍚庝粛瑕佸啀鐐广€岄噸鍚€嶏紝鏂板紑涓€杞璇濇墠杩涘綋鍓嶄細璇濄€?- `dsh-compaction-instant` 缃戦〉绔粠宸插垹闄ょ殑 `settingsScope` 鏀瑰埌 `configForms`锛岄〉闈笉鍐嶅仠鍦?Failed to load plugins銆?- 鍥為€€鍦?0.1.7 涓婁細寤哄嚭鏂颁細璇濓紝浣嗙晫闈粛鍋滃湪鏃у璇濓紝鐪嬭捣鏉ュ儚娌″弽搴斻€?.1.7 宸叉病鏈?`sessions.open`銆傜幇鍦ㄦ敼鐢?`uiWorkspace.openSession` 鍒囧埌鏂颁細璇濓紝骞舵妸涓婁竴鍙ュ～鍥炶緭鍏ユ銆傚け璐ュ師鍥犳樉绀哄湪鎸夐挳涓娿€?- README 鐨勮禐璧忓尯鎹㈡垚闈炵泩鍒╁０鏄庯細涓ョ鍟嗕笟鍞崠銆佷粯璐瑰€掑崠鎴栭粦鐏颁骇鐗熷埄锛屼粎渚涙妧鏈弬鑰冦€?
## English

- Aligned with **dsh 0.1.7-rc.1**. The workspace-instruction constant is now `AGENT_INSTRUCTIONS_INTRO`. The sentence is unchanged, and the patch follows it.
- Sandbox `confine()` is now `async confine(argv, policy, signal)`, and the patch matches that function. Passthrough behavior is the same as the previous release.
- Subagent depth lives on `dsh-subagent`. The default moves from 1 to 10. The depth check remains.
- The settings service again exposes the old `register` / `get` methods, so plugins such as `dsh-mnemon` and `dsh-better-reasoning-effort` keep working. Official `describe` / `update` stay. The patch applies once and does not insert itself again on startup.
- Patch text that no longer exists in 0.1.7 is removed, including the extra `dsh-web-fetch-http` dependency on `dsh-base`. The official package already depends on it.
- The four built-in Web presets (standard, ptc, cordis, minimal) lose only the identity sentence. The working-directory suffix, tool lists, `ptc` mode, and minimal's `complete: true` plus `includeRuntimeContext: false` stay.
- When `complete: true`, `prompt-inject.md` is still prepended to that section. A host upgrade or an older hook that drops the section does not drop the inject. After Apply you still click Restart and start a new chat before it enters the session.
- The `dsh-compaction-instant` web client uses `configForms` instead of the removed `settingsScope`, so the page no longer stops on Failed to load plugins.
- Rewind on 0.1.7 created the new session and left the UI on the old chat, so the click looked dead. 0.1.7 has no `sessions.open`. The button now opens the new session with `uiWorkspace.openSession` and puts the previous user line back in the composer. A failure shows on the button.
- The README sponsor block is now a non-profit notice: no commercial resale and no gray-market profit; technical reference only.
