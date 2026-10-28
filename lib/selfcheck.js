// Purge self-check: prove, layer by layer, that the bypass actually exists on
// this machine — instead of trusting "插件装上了" as evidence.
// 精简移植版：只依赖本地 core / hostctl / fs，不引入 instance/community 等外部模块。
import fs from "node:fs";
import path from "node:path";
import * as core from "./core.js";

/**
 * 每一层都对应一条（或一组）真实补丁，`why` 说明"这层没了会发生什么"。
 * kind: host=宿主源码补丁，runtime=插件运行时注入，config=当前 profile 的选择。</n */
export const BYPASS_LAYERS = Object.freeze([
  { ids: [15], title: "沙箱 confine 直通", kind: "host",
    why: "read-only / workspace-write 也不再把命令包进 bwrap 等 runner，denial 签名为空" },
  { ids: [16], title: "文件系统围栏禁用", kind: "host",
    why: "写/改文件不再因只读或工作区边界被 FS_SANDBOX_DENIED 拦掉" },
  { ids: [17], title: "观察策略放行", kind: "host",
    why: "edit 不再要求先 read，版本冲突门也放行" },
  { ids: [6, 33, 48], title: "拒绝话术中性化", kind: "host",
    why: "工具描述里不再教模型'沙箱会拒绝，请申请审批'" },
  { ids: [7, 8, 10], title: "默认策略", kind: "host",
    why: "沙箱默认 danger-full-access、审批默认 never（可被 UI 覆盖，不写死 env）" },
  { ids: [9, 35], title: "审批自动放行", kind: "host",
    why: "审批门直接授信；rejected/cancelled/unavailable 也不再抛错打断回合" },
  { ids: [59], title: "Auto Review 不拦工具", kind: "host",
    why: "官方自动审查不再否决工具调用" },
  { ids: [60, 62, 61], title: "工具审批 fail-open", kind: "host",
    why: "run_code / 无审批通道时放行；用户主动点拒绝仍然拒绝" },
  { ids: [63], title: "计划模式不硬拦", kind: "host",
    why: "操作者要求实施时，计划模式不再拒绝执行" },
  { ids: [4, 25, 43], optionalIds: [71, 76], title: "官方身份剥离", kind: "host",
    why: "去掉 'You are a coding agent powered by ...' 与内置预设身份句" },
  { ids: [32, 53], title: "Web 面身份中性化", kind: "host",
    why: "Web 面提示词不再自称 DeepSeek Harness，也不再禁止另起服务" },
  { ids: [40, 74, 55, 72], title: "注入不被预设覆盖", kind: "host",
    why: "complete 预设、首轮 assemble、每步 system 替换都保留 dsh-purge 注入" },
  { ids: [26, 28], optionalIds: [28], title: "极简/梁神预设保留注入", kind: "host",
    why: "minimal 预设 open inject；梁神 phase-1 不被剥掉" },
  { ids: [29, 50], title: "外部内容不降级为只读", kind: "host",
    why: "web/session 引用内容仍可作为可执行数据使用" },
  { ids: [30, 31, 64, 65], optionalIds: [30, 31, 64, 65], title: "Hooks 不否决回合", kind: "host",
    why: "装了 hooks-claude-code / hooks-codex 时，deny 不再 reject 整轮" },
  { ids: [21, 22, 23], title: "工具上限放宽", kind: "host",
    why: "bash 等待恢复、read 上限放宽、子代理深度默认 3→10" },
  { ids: [24, 37], title: "预设与子代理不设锁", kind: "host",
    why: "preset fetch 打开；子代理 scope-lock 文案中性化，不让它自我收窄" },
  { ids: [51, 52], title: "新会话与日志默认", kind: "host",
    why: "新会话保持 full access；官方 session log 默认不上传" },
  { ids: [56, 58, 75, 77], title: "回退不残留", kind: "host",
    why: "回退只藏被撤掉的那轮、标记不进模型请求、任务回收、append 即替换窗口" },
  { ids: [47, 49, 57, 69], title: "模型网关兼容", kind: "host",
    why: "OAuth 不插 Claude 身份、developer role 回退、stream 连接不被补丁打坏" },
  { ids: [87, 88, 90], title: "会话消息投递与挂载", kind: "host",
    why: "悬空注入块按 LF 锚点去重、不糊成两份；steer 回到 next-step" },
]);

function notApplicable(patch, value) {
  return value === "na" || value === "not_needed" || (patch && patch.optional && ["skipped", "missing_file", "off", "unknown"].includes(value));
}

export function tallyPatchStatus(status = {}, patches = core.ALL_PATCHES) {
  const result = { applied: 0, total: 0, all: patches.length, na: 0, skipped: 0, missing_file: 0, off: 0, not_applicable: 0, partial: 0 };
  for (const patch of patches) {
    const value = status[patch.id];
    if (["na", "skipped", "missing_file", "off"].includes(value)) result[value]++;
    if (value === "partial") result.partial++;
    if (notApplicable(patch, value)) result.not_applicable++;
    else {
      result.total++;
      if (value === "applied" || value === "already") result.applied++;
    }
  }
  return result;
}

export function rollupLayers(status = {}, hasHost, options = {}) {
  const statusFailed = Boolean(options.statusError);
  const layers = [];
  const metadata = new Map((options.patches || core.ALL_PATCHES).map((p) => [p.id, p]));
  for (const layer of BYPASS_LAYERS) {
    const optionalIds = new Set(layer.optionalIds || []);
    const rows = layer.ids.map((id) => ({
      id,
      optional: metadata.has(id) ? !!metadata.get(id).optional : optionalIds.has(id),
      status: status[id] || (hasHost ? "unknown" : "unlocated"),
    }));
    const required = rows.filter((row) => !notApplicable({ ...metadata.get(row.id), optional: row.optional }, row.status));
    const applied = rows.filter((row) => row.status === "applied" || row.status === "already");
    const pending = required.filter((row) => row.status === "pending");
    const broken = required.filter((row) => !["applied", "already", "pending", "unlocated", "unknown"].includes(row.status));
    const absent = rows.filter((row) => notApplicable({ ...metadata.get(row.id), optional: row.optional }, row.status));
    const unknown = statusFailed || rows.some((row) => row.status === "unlocated" || row.status === "unknown");
    const state = broken.length ? "broken" : unknown ? "unknown" : pending.length ? "pending" : "ok";
    layers.push({
      title: layer.title,
      why: layer.why,
      kind: layer.kind,
      ids: layer.ids,
      ok: state === "ok",
      state,
      applied: applied.length,
      required: required.length,
      total: rows.length,
      pending: pending.map((row) => row.id),
      absent: absent.map((row) => row.id),
      broken: broken.map((row) => ({ id: row.id, status: row.status })),
      note: statusFailed
        ? `读取补丁状态失败，这一层没有被核对：${options.statusError}`
        : unknown ? "宿主未定位或返回状态不完整，无法核对这一层；不代表补丁未生效"
        : absent.length === rows.length ? "目标插件/预设未安装，这一层当前不适用" : "",
      ...(statusFailed ? { status_error: options.statusError } : {}),
    });
  }
  return layers;
}

function runtimeLayer(dshHome) {
  const file = dshHome ? path.join(dshHome, "prompt-inject.md") : "";
  let bytes = 0, exists = false;
  try { if (file && fs.statSync(file).isFile()) { exists = true; bytes = fs.statSync(file).size; } } catch { /* no file */ }
  return { ok: exists && bytes > 0, bytes, exists, file };
}

function configLayer(dshHome) {
  // 读 profile package.json 看 dsh-purge 是否在 bundles（挂载证据）
  let mounted = false, note = "";
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dshHome, "profiles", "desktop", "package.json"), "utf8"));
    const bundles = pkg?.dsh?.profile?.bundles || pkg?.dsh?.bundles || [];
    mounted = bundles.includes("dsh-purge");
    note = mounted ? "" : "dsh-purge 未出现在 profile bundles，插件未挂载";
  } catch (e) { note = "无法读取 profile package.json：" + String(e && e.message || e); }
  return { ok: mounted, state: mounted ? "ok" : "broken", note, mounted };
}

/**
 * 逐层自检。
 * @param aiBase - 目标宿主 @deepseek-ai 根（空则用 core.findAiBase()）。
 * @param dshHome - DSH 数据目录（默认 core.findDshHome()）。
 */
export async function selfCheck(aiBase, dshHome = core.findDshHome(), options = {}) {
  const base = aiBase || (typeof core.findAiBase === "function" ? core.findAiBase() : "");
  const services = options.coreModule || core;
  let status = {};
  let statusError = "";
  let host = "";
  if (base) {
    try {
      host = base;
      status = await services.patchStatus(base, services.ALL_PATCHES);
    } catch (e) { status = {}; statusError = String(e && e.message ? e.message : e); }
  }
  const layers = rollupLayers(status, Boolean(host), { statusError, patches: services.ALL_PATCHES });
  const grouped = new Set(BYPASS_LAYERS.flatMap((layer) => layer.ids));
  const missing = services.ALL_PATCHES.filter((p) => !grouped.has(p.id) && !p.optional && status[p.id] === "missing_file");
  if (missing.length) layers.push({
    title: "其他必需目标文件", kind: "host", why: "安装缺少必需目标文件，需要核对目标路径或安装完整性",
    ids: missing.map((p) => p.id), ok: false, state: "broken", applied: 0, total: missing.length,
    pending: [], broken: missing.map((p) => ({ id: p.id, status: "missing_file" })),
  });
  const runtime = runtimeLayer(dshHome);
  layers.push({
    title: "运行时提示词注入", why: "prompt-inject.md 作为 dsh-purge section 参与每一步 system prompt 组装",
    kind: "runtime", ids: [], ok: runtime.ok, state: runtime.ok ? "ok" : "broken",
    applied: runtime.ok ? 1 : 0, total: 1, pending: [],
    broken: runtime.ok ? [] : [{ id: "inject", status: "empty" }], detail: runtime,
  });
  const config = configLayer(dshHome);
  layers.push({
    title: "当前 profile 的挂载状态", why: "profile bundles 里含 dsh-purge 才说明插件真的被加载",
    kind: "config", ids: [], ok: config.ok, state: config.state, note: config.note,
    applied: config.ok ? 1 : 0, total: 1, pending: [],
    broken: config.state === "broken" ? [{ id: "bundle", status: "unmounted" }] : [], detail: config,
  });

  const byKind = (kind) => layers.filter((layer) => layer.kind === kind && layer.applicable !== false);
  const summarize = (list) => ({ ok: list.every((layer) => layer.ok), passed: list.filter((layer) => layer.ok).length, total: list.length });
  const baseSummary = {
    host: summarize(byKind("host")),
    runtime: summarize(byKind("runtime")),
    config: summarize(byKind("config")),
  };
  const uncertain = layers.filter((layer) => ["unknown", "inferred"].includes(layer.state));
  const failed = layers.filter((layer) => !layer.ok);
  const pendingLayers = layers.filter((layer) => layer.state === "pending");
  const brokenLayers = layers.filter((layer) => layer.state === "broken");
  return {
    ok: failed.length === 0,
    state: brokenLayers.length ? "broken" : pendingLayers.length ? "pending" : uncertain.some((layer) => layer.state === "unknown") ? "unknown" : uncertain.length ? "inferred" : "ok",
    needsApply: brokenLayers.length === 0 && pendingLayers.length > 0,
    summary: {
      ...baseSummary,
      pending: { layers: pendingLayers.length, patches: pendingLayers.reduce((n, l) => n + l.pending.length, 0) },
      uncertain: { layers: uncertain.length },
      broken: { layers: brokenLayers.length },
    },
    host,
    patch: tallyPatchStatus(status, services.ALL_PATCHES),
    layers,
    hints: failed.map((layer) => ({
      title: layer.title,
      action: layer.kind === "config"
        ? (config.note || "在插件面板点一次「应用」，或确认 profile bundles 含 dsh-purge")
        : layer.kind === "runtime"
          ? "写入 prompt-inject.md 或在插件设置里保存一次提示词"
          : layer.status_error
            ? `读取补丁状态失败：${layer.status_error}；先解决这个报错，别据此重装或改权限`
            : layer.state === "unknown"
              ? (layer.note || "未定位当前宿主；请明确当前实例的 DSH_BASE")
              : `运行 diagnose 看 #${layer.ids.join("/#")} 的锚点`,
    })),
  };
}
