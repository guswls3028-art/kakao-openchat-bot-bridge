import { createHmac, timingSafeEqual } from "node:crypto";

function parseTimestamp(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return number < 1_000_000_000_000 ? number * 1000 : number;
}

function firstHeaderValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

export function verifyWebhookHmac({ config, request, rawBody, claimNonce }) {
  const secret = config.server.hmacSecret;
  if (!secret) return true;

  const timestampValue = firstHeaderValue(request.headers["x-bot-timestamp"]);
  const signatureHeader = String(request.headers["x-bot-signature"] || "");
  const nonce = String(firstHeaderValue(request.headers["x-bot-nonce"]) || "").trim();
  const timestamp = parseTimestamp(timestampValue);
  if (!timestamp || !nonce || nonce.length > 200) return false;

  const maxSkewMs = config.server.hmacMaxSkewMs || 5 * 60 * 1000;
  if (Math.abs(Date.now() - timestamp) > maxSkewMs) return false;

  const expected = createHmac("sha256", secret)
    .update(`${timestampValue}.${nonce}.${rawBody}`)
    .digest("hex");
  const actual = signatureHeader.replace(/^sha256=/iu, "");
  const expectedBuffer = Buffer.from(expected, "hex");
  const actualBuffer = Buffer.from(actual, "hex");
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) {
    return false;
  }

  return typeof claimNonce === "function" ? claimNonce(nonce, maxSkewMs) : false;
}
