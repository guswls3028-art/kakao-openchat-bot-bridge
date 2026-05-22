import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { JsonStore } from "../src/infrastructure/store.mjs";
import { createServer } from "../src/presentation/server.mjs";

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
      allowSenderAdminCommands: true,
      mention: "@봇",
    },
    questionApi: { endpoint: "", secret: "", publicBaseUrl: "" },
  };
  const store = new JsonStore(dataDir);
  return createServer({ config, store });
}

function sign(secret, timestamp, nonce, body) {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${nonce}.${body}`).digest("hex")}`;
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

test("message endpoint can require HMAC signature and nonce", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "kakao-openchat-hmac-"));
  const config = {
    server: {
      secret: "",
      hmacSecret: "hmac-secret",
      hmacMaxSkewMs: 300_000,
    },
    kakao: {
      roomAllowList: ["테스트방"],
      botNicknames: ["봇"],
      adminSenders: [],
      allowSenderAdminCommands: false,
      mention: "@봇",
    },
    questionApi: { endpoint: "", secret: "", publicBaseUrl: "" },
  };
  const store = new JsonStore(dataDir);
  const server = createServer({ config, store });
  const base = await listen(server);
  try {
    const body = JSON.stringify({ room: "테스트방", sender: "방장", text: "/핑" });
    const timestamp = String(Date.now());
    const nonce = "nonce-1";
    const headers = {
      "content-type": "application/json",
      "x-bot-timestamp": timestamp,
      "x-bot-signature": sign(config.server.hmacSecret, timestamp, nonce, body),
      "x-bot-nonce": nonce,
    };

    const ok = await fetch(`${base}/events/kakao-message`, { method: "POST", headers, body });
    assert.equal(ok.status, 200);

    const replay = await fetch(`${base}/events/kakao-message`, { method: "POST", headers, body });
    assert.equal(replay.status, 401);

    const unsignedNonceChange = await fetch(`${base}/events/kakao-message`, {
      method: "POST",
      headers: { ...headers, "x-bot-nonce": "nonce-2" },
      body,
    });
    assert.equal(unsignedNonceChange.status, 401);

    const missingNonce = await fetch(`${base}/events/kakao-message`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-bot-timestamp": timestamp,
        "x-bot-signature": sign(config.server.hmacSecret, timestamp, "nonce-3", body),
      },
      body,
    });
    assert.equal(missingNonce.status, 401);
  } finally {
    server.close();
  }
});

test("batch endpoint can require HMAC signature and nonce", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "kakao-openchat-hmac-batch-"));
  const config = {
    server: {
      secret: "",
      hmacSecret: "hmac-secret",
      hmacMaxSkewMs: 300_000,
    },
    kakao: {
      roomAllowList: ["테스트방"],
      botNicknames: ["봇"],
      adminSenders: [],
      allowSenderAdminCommands: false,
      mention: "@봇",
    },
    questionApi: { endpoint: "", secret: "", publicBaseUrl: "" },
  };
  const store = new JsonStore(dataDir);
  const server = createServer({ config, store });
  const base = await listen(server);
  try {
    const body = JSON.stringify({ messages: [{ room: "테스트방", sender: "방장", text: "/핑" }] });
    const timestamp = String(Date.now());
    const nonce = "batch-nonce-1";
    const headers = {
      "content-type": "application/json",
      "x-bot-timestamp": timestamp,
      "x-bot-signature": sign(config.server.hmacSecret, timestamp, nonce, body),
      "x-bot-nonce": nonce,
    };

    const ok = await fetch(`${base}/events/kakao-batch`, { method: "POST", headers, body });
    assert.equal(ok.status, 200);

    const bad = await fetch(`${base}/events/kakao-batch`, {
      method: "POST",
      headers: { ...headers, "x-bot-nonce": "batch-nonce-2" },
      body,
    });
    assert.equal(bad.status, 401);
  } finally {
    server.close();
  }
});
