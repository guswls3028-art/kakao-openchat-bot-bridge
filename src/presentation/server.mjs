import http from "node:http";
import { createBot } from "../application/bot.mjs";
import { verifyWebhookHmac } from "../security/webhook-auth.mjs";

function send(response, status, body, headers = {}) {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  response.writeHead(status, {
    "content-type": typeof body === "string" ? "text/plain; charset=utf-8" : "application/json; charset=utf-8",
    ...headers,
  });
  response.end(payload);
}

const LOG_TEXT_MAX = 1000;

function truncate(value, max = LOG_TEXT_MAX) {
  const text = String(value || "");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function readBody(request, maxBytes = 1024 * 1024, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    const timer = setTimeout(() => {
      reject(new Error("body_timeout"));
      request.destroy();
    }, timeoutMs);
    function finish(fn, value) {
      clearTimeout(timer);
      fn(value);
    }
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        finish(reject, new Error("body_too_large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => finish(resolve, Buffer.concat(chunks).toString("utf8")));
    request.on("error", (error) => finish(reject, error));
  });
}

function verifySecret(config, request) {
  const expected = config.server.secret;
  if (!expected) return true;
  const header = request.headers["x-bot-secret"];
  const bearer = String(request.headers.authorization || "").replace(/^Bearer\s+/iu, "");
  return header === expected || bearer === expected;
}

function verifyHmac(config, request, body, store) {
  return verifyWebhookHmac({
    config,
    request,
    rawBody: body,
    claimNonce: (nonce, ttlMs) => store?.claimDedupe?.(`webhook_nonce:${nonce}`, ttlMs) ?? false,
  });
}

function normalizeMessage(input) {
  return {
    room: String(input?.room || ""),
    sender: String(input?.sender || input?.author || ""),
    text: String(input?.text || input?.message || ""),
    raw: input || {},
  };
}

function publicMessage(message) {
  return {
    room: message.room,
    sender: message.sender,
    text: message.text,
  };
}

function logMessage(message) {
  const raw = message.raw || {};
  return {
    room: truncate(message.room, 120),
    sender: truncate(message.sender, 120),
    text: truncate(message.text, LOG_TEXT_MAX),
    raw: {
      id: raw.id || raw.messageId || raw.msgId || raw.logId || undefined,
      type: raw.type || raw.eventType || undefined,
      createdAt: raw.createdAt || raw.timestamp || undefined,
    },
  };
}

function appendEventSafe(store, event) {
  try {
    store.appendEvent(event);
  } catch {
    // Store implementations should be best-effort here; keep webhook response flowing.
  }
}

async function withTimeout(promise, timeoutMs, code = "webhook_timeout") {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(code)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function formatResult(result, format) {
  if (format === "text") return result.action === "reply" ? result.reply || "" : "";
  return result;
}

export function createServer({ config, store, questionPoster }) {
  const bot = createBot({ config, store, questionPoster });

  return http.createServer(async (request, response) => {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

    if (request.method === "GET" && url.pathname === "/health") {
      return send(response, 200, {
        ok: true,
        service: "kakao-openchat-bot-bridge",
        hasSecret: Boolean(config.server.secret),
        hasQuestionApi: Boolean(config.questionApi.endpoint),
      });
    }

    if (request.method !== "POST") {
      return send(response, 404, { error: "not_found" });
    }

    if (!verifySecret(config, request)) {
      return send(response, 401, { error: "unauthorized" });
    }

    if (url.pathname === "/events/kakao-message") {
      try {
        const timeoutMs = config.server.webhookTimeoutMs || 12000;
        const body = await readBody(request, 1024 * 1024, timeoutMs);
        if (!verifyHmac(config, request, body, store)) {
          return send(response, 401, { error: "unauthorized" });
        }
        const input = body ? JSON.parse(body) : {};
        const message = normalizeMessage(input);
        const result = await withTimeout(bot.handle(message), timeoutMs, "webhook_timeout");
        appendEventSafe(store, { type: "message", message: logMessage(message), result });
        const formatted = formatResult(result, url.searchParams.get("format"));
        return send(response, 200, formatted);
      } catch (error) {
        const status = error?.message === "webhook_timeout" || error?.message === "body_timeout" ? 504 : 400;
        return send(response, status, {
          error: error instanceof Error ? error.message : "bad_request",
        });
      }
    }

    if (url.pathname === "/events/kakao-batch") {
      try {
        const timeoutMs = config.server.webhookTimeoutMs || 12000;
        const startedAt = Date.now();
        const body = await readBody(request, 2 * 1024 * 1024, timeoutMs);
        if (!verifyHmac(config, request, body, store)) {
          return send(response, 401, { error: "unauthorized" });
        }
        const input = body ? JSON.parse(body) : {};
        const messages = Array.isArray(input.messages) ? input.messages : [];
        const results = [];
        let timedOut = false;
        const maxMessages = config.server.batchMaxMessages || 25;
        for (const item of messages.slice(0, maxMessages)) {
          const remainingMs = timeoutMs - (Date.now() - startedAt);
          if (remainingMs <= 250) {
            timedOut = true;
            break;
          }
          const message = normalizeMessage(item);
          try {
            const result = await withTimeout(bot.handle(message), remainingMs, "webhook_timeout");
            appendEventSafe(store, { type: "batch_message", message: logMessage(message), result });
            results.push({ message: publicMessage(message), result });
          } catch (error) {
            timedOut = error?.message === "webhook_timeout";
            results.push({
              message: publicMessage(message),
              result: { action: "error", error: error instanceof Error ? error.message : "unknown_error" },
            });
            if (timedOut) break;
          }
        }
        return send(response, 200, {
          results,
          truncated: messages.length > maxMessages,
          timedOut,
        });
      } catch (error) {
        const status = error?.message === "body_timeout" ? 504 : 400;
        return send(response, status, {
          error: error instanceof Error ? error.message : "bad_request",
        });
      }
    }

    return send(response, 404, { error: "not_found" });
  });
}
