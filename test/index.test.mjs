import assert from "node:assert/strict";
import test from "node:test";
import { assertWebhookSecret } from "../src/index.mjs";

function config(overrides = {}) {
  return {
    nodeEnv: "production",
    server: {
      secret: "",
      hmacSecret: "",
      host: "0.0.0.0",
      allowInsecureWebhook: false,
      ...overrides.server,
    },
    ...overrides,
  };
}

test("production public bind requires webhook secret even when insecure flag is set", () => {
  assert.throws(
    () =>
      assertWebhookSecret(
        config({
          server: {
            allowInsecureWebhook: true,
          },
        }),
      ),
    /KAKAO_BOT_SECRET or KAKAO_WEBHOOK_HMAC_SECRET/u,
  );
});

test("insecure webhook flag is allowed only for isolated local testing", () => {
  assert.doesNotThrow(() =>
    assertWebhookSecret(
      config({
        nodeEnv: "development",
        server: {
          host: "127.0.0.1",
          allowInsecureWebhook: true,
        },
      }),
    ),
  );
});
