import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createBot } from "../src/application/bot.mjs";
import { JsonStore } from "../src/infrastructure/store.mjs";

function fixture() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "kakao-openchat-bot-"));
  const config = {
    kakao: {
      roomAllowList: ["테스트방"],
      botNicknames: ["봇"],
      adminSenders: ["방장"],
      allowSenderAdminCommands: true,
      mention: "@봇",
    },
    questionApi: { endpoint: "", secret: "", publicBaseUrl: "" },
  };
  const store = new JsonStore(dataDir);
  const bot = createBot({ config, store });
  return { bot, store, dataDir };
}

test("responds to ping", async () => {
  const { bot } = fixture();
  const result = await bot.handle({ room: "테스트방", sender: "방장", text: "/핑" });
  assert.equal(result.action, "reply");
  assert.match(result.reply, /pong/u);
});

test("ignores rooms outside allowlist", async () => {
  const { bot } = fixture();
  const result = await bot.handle({ room: "다른방", sender: "방장", text: "/핑" });
  assert.equal(result.action, "ignored");
  assert.equal(result.reason, "room_not_allowed");
});

test("only admins can set notice", async () => {
  const { bot } = fixture();
  const rejected = await bot.handle({ room: "테스트방", sender: "유저", text: "/공지설정 테스트" });
  assert.equal(rejected.action, "reply");
  assert.match(rejected.reply, /관리자/u);

  const accepted = await bot.handle({ room: "테스트방", sender: "방장", text: "/공지설정 테스트 공지" });
  assert.equal(accepted.action, "reply");
  assert.match(accepted.reply, /완료/u);
});

test("accepts question text even when no question API is configured", async () => {
  const { bot } = fixture();
  const result = await bot.handle({
    room: "테스트방",
    sender: "유저",
    text: "@봇 질문 올려줘 초대장은 어디서 얻나요?",
  });
  assert.equal(result.action, "reply");
  assert.match(result.reply, /QUESTION_API_ENDPOINT/u);
});
