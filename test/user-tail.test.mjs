import test from "node:test";
import assert from "node:assert/strict";
import { appendUserTail, USER_TAIL_TEXT } from "../lib/user-tail.js";

test("appendUserTail 追加到最后一条 user 消息（字符串 content）", () => {
  const msgs = [
    { role: "system", content: "sys" },
    { role: "user", content: "第一条" },
    { role: "assistant", content: "答" },
    { role: "user", content: "做这件事" },
  ];
  const out = appendUserTail(msgs);
  assert.notEqual(out, msgs);
  assert.equal(out[3].content, "做这件事\n\n" + USER_TAIL_TEXT);
  assert.equal(out[1].content, "第一条"); // 早先的 user 消息不动
  assert.equal(msgs[3].content, "做这件事"); // 不原地改
});

test("appendUserTail 支持 parts 数组 content", () => {
  const msgs = [
    { role: "user", content: [{ type: "text", text: "看图" }, { type: "image_url", image_url: { url: "x" } }] },
  ];
  const out = appendUserTail(msgs);
  assert.equal(out[0].content[0].text, "看图\n\n" + USER_TAIL_TEXT);
  assert.equal(out[0].content[1].type, "image_url");
});

test("appendUserTail 幂等：已含 nudge 不再追加", () => {
  const msgs = [{ role: "user", content: "问\n\n" + USER_TAIL_TEXT }];
  assert.equal(appendUserTail(msgs), msgs);
});

test("appendUserTail 无 user 消息或空数组时原样返回", () => {
  const none = [{ role: "assistant", content: "a" }];
  assert.equal(appendUserTail(none), none);
  const empty = [];
  assert.equal(appendUserTail(empty), empty);
  assert.equal(appendUserTail(undefined), undefined);
});
