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
    server: {
      host: env.KAKAO_BOT_HOST || "0.0.0.0",
      port: numberFromEnv(env.KAKAO_BOT_PORT, 4040, { min: 1, max: 65535 }),
      secret: env.KAKAO_BOT_SECRET || "",
    },
    kakao: {
      roomAllowList: splitList(env.KAKAO_ROOM_ALLOWLIST),
      botNicknames: splitList(env.KAKAO_BOT_NICKNAMES),
      adminSenders: splitList(env.KAKAO_ADMIN_SENDERS),
      mention: env.KAKAO_BOT_MENTION || "@봇",
    },
    questionApi: {
      endpoint: env.QUESTION_API_ENDPOINT || "",
      secret: env.QUESTION_API_SECRET || "",
      publicBaseUrl: trimTrailingSlash(env.PUBLIC_BASE_URL || ""),
    },
    dataDir,
  };
}

export function ensureDataDir(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
}
