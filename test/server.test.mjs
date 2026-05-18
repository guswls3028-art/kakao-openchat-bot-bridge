import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createServer } from "../src/server.mjs";
import { JsonStore } from "../src/store.mjs";

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function fixture() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "kakao-openchat-server-"));
  const config = {
    server: { secret: "secret" },
    kakao: {
      roomAllowList: ["테스트방"],
      botNicknames: ["봇"],
      adminSenders: ["방장"],
      mention: "@봇",
    },
    questionApi: { endpoint: "", secret: "", publicBaseUrl: "" },
  };
  const store = new JsonStore(dataDir);
  return createServer({ config, store });
}

test("health endpoint works", async () => {
  const server = fixture();
  const base = await listen(server);
  try {
    const response = await fetch(`${base}/health`);
    assert.equal(response.status, 200);
    const json = await response.json();
    assert.equal(json.ok, true);
  } finally {
    server.close();
  }
});

test("message endpoint requires secret and can return text", async () => {
  const server = fixture();
  const base = await listen(server);
  try {
    const unauthorized = await fetch(`${base}/events/kakao-message`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ room: "테스트방", sender: "방장", text: "/핑" }),
    });
    assert.equal(unauthorized.status, 401);

    const ok = await fetch(`${base}/events/kakao-message?format=text`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-bot-secret": "secret" },
      body: JSON.stringify({ room: "테스트방", sender: "방장", text: "/핑" }),
    });
    assert.equal(ok.status, 200);
    assert.match(await ok.text(), /pong/u);
  } finally {
    server.close();
  }
});
