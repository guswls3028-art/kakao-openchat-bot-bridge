#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { createBot } from "./application/bot.mjs";
import { ensureDataDir, loadConfig } from "./config/config.mjs";
import { JsonStore } from "./infrastructure/store.mjs";
import { createServer } from "./presentation/server.mjs";

function parseFlags(argv) {
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg?.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    flags[key] = next && !next.startsWith("--") ? next : "true";
    if (next && !next.startsWith("--")) index += 1;
  }
  return flags;
}

function printHelp() {
  console.log(`kakao-openchat-bot-bridge

Usage:
  node src/index.mjs serve
  node src/index.mjs test-message --room 테스트방 --sender 방장 --text /핑

Environment:
  Copy .env.example to .env and edit values.
`);
}

function isPublicBindHost(host) {
  const value = String(host || "").trim().toLowerCase();
  return value === "" || value === "0.0.0.0" || value === "::" || value === "[::]";
}

export function assertWebhookSecret(config) {
  if (config.server.secret || config.server.hmacSecret) return;
  if (config.server.allowInsecureWebhook && config.nodeEnv !== "production" && !isPublicBindHost(config.server.host)) return;
  if (config.nodeEnv !== "production" && !isPublicBindHost(config.server.host)) return;
  throw new Error(
    "KAKAO_BOT_SECRET or KAKAO_WEBHOOK_HMAC_SECRET is required for production or public webhook binding. Set KAKAO_ALLOW_INSECURE_WEBHOOK=true only for isolated local testing.",
  );
}

function assertRoomScope(config) {
  if (config.kakao.allowAllRooms) return;
  if (config.kakao.roomAllowList.length > 0) return;
  if (config.nodeEnv !== "production") return;
  throw new Error(
    "KAKAO_ROOM_ALLOWLIST is required in production. Set KAKAO_ALLOW_ALL_ROOMS=true only when all rooms are intentionally allowed.",
  );
}

function isEntrypoint() {
  const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
  return import.meta.url === entry;
}

async function main() {
  const [command = "serve", ...rest] = process.argv.slice(2);
  if (command === "--help" || command === "-h" || command === "help") {
    printHelp();
    return;
  }

  const config = loadConfig();
  ensureDataDir(config.dataDir);
  const store = new JsonStore(config.dataDir);

  if (command === "test-message") {
    const flags = parseFlags(rest);
    const bot = createBot({ config, store });
    const result = await bot.handle({
      room: flags.room || "테스트방",
      sender: flags.sender || "방장",
      text: flags.text || "/핑",
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command !== "serve") {
    printHelp();
    process.exitCode = 1;
    return;
  }

  const server = createServer({ config, store });
  assertWebhookSecret(config);
  assertRoomScope(config);
  server.listen(config.server.port, config.server.host, () => {
    console.log(
      `kakao-openchat-bot-bridge listening on http://${config.server.host}:${config.server.port}`,
    );
  });
}

if (isEntrypoint()) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : error);
    process.exitCode = 1;
  });
}
