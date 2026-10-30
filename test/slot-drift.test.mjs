import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mdPath = path.join(root, "lib", "default-prompt-inject.md");
const hashPath = path.join(root, "lib", "slot.sha256");
const hasSource = fs.existsSync(mdPath);

// 加密槽完整性：干净检出（无明文源）也能验 → CI 上必跑，堵住"改槽不重嵌"这条沉默退化。
test("加密槽 sha256 与 lib/slot.sha256 一致（干净检出也校验）", async () => {
  const { openSlot } = await import(pathToFileURL(path.join(root, "lib", "table-read.js")).href);
  const crypto = await import("node:crypto");
  const want = fs.readFileSync(hashPath, "utf8").trim();
  const got = crypto.createHash("sha256").update(openSlot(), "utf8").digest("hex");
  assert.equal(
    got,
    want,
    `槽内容与 lib/slot.sha256 不一致：槽=${got} 期望=${want}。改过明文源请跑 node scripts/embed-default-prompt.mjs 并更新 lib/slot.sha256。`,
  );
});

// 明文源只在开发机存在（已 gitignore）。干净检出 / 发行包跳过，不误报。
test("加密槽与明文源逐字节一致（忘跑 embed 即在此爆红）", { skip: hasSource ? false : "无 lib/default-prompt-inject.md，跳过" }, async () => {
  const { openSlot } = await import(pathToFileURL(path.join(root, "lib", "table-read.js")).href);
  const want = fs.readFileSync(mdPath, "utf8");
  const got = openSlot();
  if (got !== want) {
    let i = 0;
    while (i < got.length && i < want.length && got[i] === want[i]) i += 1;
    assert.fail(
      `漂移起点 字符#${i}: 槽=${JSON.stringify(got.slice(i, i + 60))} 源=${JSON.stringify(want.slice(i, i + 60))}。` +
        "重跑 node scripts/embed-default-prompt.mjs 并提交 lib/asset-table.js。",
    );
  }
  assert.equal(got.length, want.length);
});
