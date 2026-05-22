import fs from "node:fs";
import path from "node:path";

function loadDotEnv(filePath = path.resolve(process.cwd(), ".env")) {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, "utf8");
  for (const line of text.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

function splitList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function numberFromEnv(value, fallback, { min, max } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  if (min !== undefined && number < min) return fallback;
  if (max !== undefined && number > max) return fallback;
  return number;
}

function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/u, "");
}

export function loadConfig(env = process.env) {
  loadDotEnv();
  const dataDir = path.resolve(process.cwd(), env.KAKAO_BOT_DATA_DIR || "./data");
  return {
    nodeEnv: env.NODE_ENV || "development",
    server: {
      host: env.KAKAO_BOT_HOST || "0.0.0.0",
      port: numberFromEnv(env.KAKAO_BOT_PORT, 4040, { min: 1, max: 65535 }),
      secret: env.KAKAO_BOT_SECRET || "",
      hmacSecret: env.KAKAO_WEBHOOK_HMAC_SECRET || "",
      hmacMaxSkewMs: numberFromEnv(env.KAKAO_WEBHOOK_HMAC_MAX_SKEW_MS, 5 * 60 * 1000, {
        min: 30_000,
        max: 30 * 60 * 1000,
      }),
      allowInsecureWebhook: env.KAKAO_ALLOW_INSECURE_WEBHOOK === "true",
      webhookTimeoutMs: numberFromEnv(env.KAKAO_WEBHOOK_TIMEOUT_MS, 12000, {
        min: 1000,
        max: 30000,
      }),
      batchMaxMessages: numberFromEnv(env.KAKAO_BATCH_MAX_MESSAGES, 25, {
        min: 1,
        max: 100,
      }),
    },
    kakao: {
      roomAllowList: splitList(env.KAKAO_ROOM_ALLOWLIST),
      allowAllRooms: env.KAKAO_ALLOW_ALL_ROOMS === "true",
      botNicknames: splitList(env.KAKAO_BOT_NICKNAMES),
      adminSenders: splitList(env.KAKAO_ADMIN_SENDERS),
      allowSenderAdminCommands: env.KAKAO_ALLOW_SENDER_ADMIN_COMMANDS === "true",
      mention: env.KAKAO_BOT_MENTION || "@봇",
    },
    questionApi: {
      endpoint: env.QUESTION_API_ENDPOINT || "",
      secret: env.QUESTION_API_SECRET || "",
      publicBaseUrl: trimTrailingSlash(env.PUBLIC_BASE_URL || ""),
      requestTimeoutMs: numberFromEnv(env.QUESTION_API_TIMEOUT_MS, 6000, {
        min: 1000,
        max: 14000,
      }),
      dedupeTtlMs: numberFromEnv(env.QUESTION_DEDUPE_TTL_MS, 24 * 60 * 60 * 1000, {
        min: 60_000,
        max: 7 * 24 * 60 * 60 * 1000,
      }),
    },
    dataDir,
  };
}

export function ensureDataDir(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
}
