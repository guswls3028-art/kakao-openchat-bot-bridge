#!/usr/bin/env node
import { loadConfig, ensureDataDir } from "./config.mjs";
import { JsonStore } from "./store.mjs";
import { createServer } from "./server.mjs";
import { createBot } from "./bot.mjs";

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
  server.listen(config.server.port, config.server.host, () => {
    console.log(
      `kakao-openchat-bot-bridge listening on http://${config.server.host}:${config.server.port}`,
    );
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
