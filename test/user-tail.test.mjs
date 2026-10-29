import test from "node:test";
import assert from "node:assert/strict";
import { appendUserTail, USER_TAIL_TEXT } from "../lib/user-tail.js";

test("appendUserTail 追加独立提醒消息，不改用户原文", () => {
  const msgs = [
    { role: "system", content: "sys" },
    { role: "user", content: "第一条" },
    { role: "assistant", content: "答" },
    { role: "user", content: "做这件事" },
  ];
  const out = appendUserTail(msgs);
  assert.notEqual(out, msgs);
  assert.equal(out.length, 5);
  assert.deepEqual(out[4], { role: "user", content: USER_TAIL_TEXT });
  assert.equal(out[3].content, "做这件事", "用户原文必须逐字不动");
  assert.equal(msgs.length, 4, "输入数组不被修改");
});

test("appendUserTail 兼容多模态 parts：只加消息，不碰 parts", () => {
  const msgs = [
    { role: "user", content: [{ type: "text", text: "看图" }, { type: "image_url", image_url: { url: "x" } }] },
  ];
  const out = appendUserTail(msgs);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0].content[0], { type: "text", text: "看图" });
  assert.equal(out[1].role, "user");
});

test("appendUserTail 幂等：历史里已有提醒就不再追加", () => {
  const msgs = [
    { role: "user", content: "问" },
    { role: "user", content: USER_TAIL_TEXT },
  ];
  assert.equal(appendUserTail(msgs), msgs, "上一轮追加的提醒已落盘时不重复加");
});

test("appendUserTail 无 user 消息或空数组时原样返回", () => {
  const none = [{ role: "assistant", content: "a" }];
  assert.equal(appendUserTail(none), none);
  const empty = [];
  assert.equal(appendUserTail(empty), empty);
  assert.equal(appendUserTail(undefined), undefined);
});
