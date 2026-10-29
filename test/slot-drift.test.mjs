import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mdPath = path.join(root, "lib", "default-prompt-inject.md");
const hasSource = fs.existsSync(mdPath);

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
