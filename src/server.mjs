import http from "node:http";
import { createBot } from "./bot.mjs";

function send(response, status, body, headers = {}) {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  response.writeHead(status, {
    "content-type": typeof body === "string" ? "text/plain; charset=utf-8" : "application/json; charset=utf-8",
    ...headers,
  });
  response.end(payload);
}

function readBody(request, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error("body_too_large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function verifySecret(config, request) {
  const expected = config.server.secret;
  if (!expected) return true;
  const header = request.headers["x-bot-secret"];
  const bearer = String(request.headers.authorization || "").replace(/^Bearer\s+/iu, "");
  return header === expected || bearer === expected;
}

function normalizeMessage(input) {
  return {
    room: String(input?.room || ""),
    sender: String(input?.sender || input?.author || ""),
    text: String(input?.text || input?.message || ""),
    raw: input || {},
  };
}

function formatResult(result, format) {
  if (format === "text") return result.action === "reply" ? result.reply || "" : "";
  return result;
}

export function createServer({ config, store }) {
  const bot = createBot({ config, store });

  return http.createServer(async (request, response) => {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

    if (request.method === "GET" && url.pathname === "/health") {
      return send(response, 200, {
        ok: true,
        service: "kakao-openchat-bot-bridge",
        roomAllowList: config.kakao.roomAllowList,
        hasSecret: Boolean(config.server.secret),
        hasQuestionApi: Boolean(config.questionApi.endpoint),
        counts: store.state.counts,
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
        const body = await readBody(request);
        const input = body ? JSON.parse(body) : {};
        const message = normalizeMessage(input);
        const result = await bot.handle(message);
        store.appendEvent({ type: "message", message, result });
        const formatted = formatResult(result, url.searchParams.get("format"));
        return send(response, 200, formatted);
      } catch (error) {
        return send(response, 400, {
          error: error instanceof Error ? error.message : "bad_request",
        });
      }
    }

    if (url.pathname === "/events/kakao-batch") {
      try {
        const body = await readBody(request, 2 * 1024 * 1024);
        const input = body ? JSON.parse(body) : {};
        const messages = Array.isArray(input.messages) ? input.messages : [];
        const results = [];
        for (const item of messages.slice(0, 100)) {
          const message = normalizeMessage(item);
          const result = await bot.handle(message);
          store.appendEvent({ type: "batch_message", message, result });
          results.push({ message, result });
        }
        return send(response, 200, { results });
      } catch (error) {
        return send(response, 400, {
          error: error instanceof Error ? error.message : "bad_request",
        });
      }
    }

    return send(response, 404, { error: "not_found" });
  });
}
