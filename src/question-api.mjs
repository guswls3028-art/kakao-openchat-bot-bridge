function truncate(value, max) {
  const text = String(value || "").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function buildQuestionPayload({ room, sender, text }) {
  const body = String(text || "").trim();
  return {
    title: truncate(`질문: ${body.split(/\r?\n/u)[0] || "카톡방 질문"}`, 100),
    body,
    authorName: truncate(`카톡:${sender || "익명"}`, 32),
    room: String(room || ""),
    sender: String(sender || ""),
    source: "kakao-openchat",
  };
}

export async function postQuestion(config, message) {
  if (!config.questionApi.endpoint) return { configured: false };
  const payload = buildQuestionPayload(message);
  const headers = { "content-type": "application/json" };
  if (config.questionApi.secret) headers.authorization = `Bearer ${config.questionApi.secret}`;

  const response = await fetch(config.questionApi.endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!response.ok) {
    const code = data?.code || data?.error || `http_${response.status}`;
    throw new Error(`question_api_failed:${code}`);
  }
  const url = data.url || data.postUrl || (data.id && config.questionApi.publicBaseUrl
    ? `${config.questionApi.publicBaseUrl}/questions/${data.id}`
    : "");
  return { configured: true, payload, data, url };
}
