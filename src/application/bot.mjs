import { postQuestion } from "../infrastructure/question-api.mjs";

function compactWhitespace(value) {
  return String(value || "").replace(/\s+/gu, " ").trim();
}

function withoutPrefix(text, prefix) {
  const trimmed = String(text || "").trim();
  return trimmed.startsWith(prefix) ? trimmed.slice(prefix.length).trim() : "";
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isAdmin(config, sender) {
  if (!config.kakao.allowSenderAdminCommands) return false;
  const admins = config.kakao.adminSenders;
  if (admins.length === 0) return false;
  return admins.includes(String(sender || "").trim());
}

function isRoomAllowed(config, room) {
  if (config.kakao.allowAllRooms) return true;
  const allowList = config.kakao.roomAllowList;
  if (allowList.length === 0) return true;
  return allowList.includes(String(room || "").trim());
}

function isBotSender(config, sender) {
  return config.kakao.botNicknames.includes(String(sender || "").trim());
}

function helpText(config) {
  return [
    "사설봇 명령어",
    "/핑 - 상태 확인",
    "/공지 - 공지 확인",
    "/가이드 - 가이드 목록",
    "/질문 내용 - 질문 접수",
    `${config.kakao.mention} 질문 올려줘 내용 - 멘션 질문 접수`,
    "",
    "관리자",
    "/공지설정 내용",
    "/가이드추가\\n제목\\nhttps://example.com",
  ].join("\n");
}

function parseGuideAdd(text) {
  const body = withoutPrefix(text, "/가이드추가");
  const lines = body.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  if (lines.length >= 2) return { label: lines[0], url: lines[1] };
  const pipe = body.split("|").map((part) => part.trim());
  if (pipe.length >= 2) return { label: pipe[0], url: pipe[1] };
  return null;
}

function extractQuestionText(config, text) {
  const trimmed = String(text || "").trim();
  if (trimmed.startsWith("/질문")) return withoutPrefix(trimmed, "/질문");
  const mention = config.kakao.mention;
  if (mention && trimmed.startsWith(mention)) {
    const rest = trimmed.slice(mention.length).trim();
    return rest
      .replace(/^(질문\s*)?(올려줘|등록해줘|접수해줘|물어봐줘)\s*/u, "")
      .trim();
  }
  return "";
}

function questionDedupeKey({ room, sender, text, raw }) {
  const id = raw?.messageId || raw?.id || raw?.msgId || raw?.logId;
  if (id) return `question:id:${String(id)}`;
  return `question:fingerprint:${compactWhitespace(room)}|${compactWhitespace(sender)}|${compactWhitespace(text)}`;
}

export function createBot({ config, store }) {
  async function handle(message) {
    const room = compactWhitespace(message.room);
    const sender = compactWhitespace(message.sender);
    const text = String(message.text || "").trim();

    store.increment("messages");

    if (!text) return result("ignored", { reason: "empty_text" });
    if (!isRoomAllowed(config, room)) return result("ignored", { reason: "room_not_allowed" });
    if (isBotSender(config, sender)) return result("ignored", { reason: "bot_sender" });

    if (text === "/핑") {
      return result("reply", { reply: `pong ${new Date().toLocaleString("ko-KR")}` });
    }

    if (["/도움", "/봇도움", "/help"].includes(text)) {
      return result("reply", { reply: helpText(config) });
    }

    if (text === "/공지") {
      return result("reply", { reply: store.state.notice || "등록된 공지가 없습니다." });
    }

    if (text.startsWith("/공지설정")) {
      if (!isAdmin(config, sender)) return result("reply", { reply: "관리자만 공지를 설정할 수 있어요." });
      const notice = withoutPrefix(text, "/공지설정");
      if (notice.length < 2) return result("reply", { reply: "공지 내용을 함께 적어주세요." });
      store.setNotice(notice);
      return result("reply", { reply: "공지 저장 완료." });
    }

    if (text === "/가이드") {
      if (store.state.guides.length === 0) {
        return result("reply", { reply: "등록된 가이드가 없습니다." });
      }
      const lines = ["가이드 목록"];
      store.state.guides.slice(0, 10).forEach((guide, index) => {
        lines.push(`${index + 1}. ${guide.label}`);
        lines.push(guide.url);
      });
      return result("reply", { reply: lines.join("\n") });
    }

    if (text.startsWith("/가이드추가")) {
      if (!isAdmin(config, sender)) return result("reply", { reply: "관리자만 가이드를 추가할 수 있어요." });
      const parsed = parseGuideAdd(text);
      if (!parsed || !parsed.label || !isHttpUrl(parsed.url)) {
        return result("reply", { reply: "/가이드추가 다음 줄에 제목과 URL을 적어주세요." });
      }
      const guide = store.addGuide(parsed.label, parsed.url);
      return result("reply", { reply: `가이드 추가 완료.\n${guide.label}\n${guide.url}` });
    }

    const questionText = extractQuestionText(config, text);
    if (questionText) {
      if (questionText.length < 6) {
        return result("reply", { reply: "질문이 너무 짧아요. 상황을 조금 더 적어주세요." });
      }
      const dedupeKey = questionDedupeKey({ room, sender, text: questionText, raw: message.raw });
      const dedupeTtlMs = config.questionApi.dedupeTtlMs || 24 * 60 * 60 * 1000;
      const shouldDedupe = Boolean(config.questionApi.endpoint && store.claimDedupe);
      if (shouldDedupe && !store.claimDedupe(dedupeKey, dedupeTtlMs)) {
        return result("reply", { reply: "이미 접수 처리 중이거나 접수된 질문입니다." });
      }
      try {
        const posted = await postQuestion(config, { room, sender, text: questionText });
        if (posted.configured) {
          store.increment("forwardedQuestions");
          return result("reply", {
            reply: posted.url
              ? `질문 등록 완료.\n${posted.url}`
              : "질문 등록 완료.",
          });
        }
        return result("reply", {
          reply: [
            "질문 접수 형식은 확인됐지만 QUESTION_API_ENDPOINT가 설정되지 않았어요.",
            "서버 연동 후 자동 등록됩니다.",
          ].join("\n"),
        });
      } catch (error) {
        if (shouldDedupe && store.releaseDedupe) store.releaseDedupe(dedupeKey);
        return result("reply", {
          reply: `질문 등록 실패: ${error instanceof Error ? error.message : "unknown_error"}`,
        });
      }
    }

    return result("ignored", { reason: "not_command" });
  }

  function result(action, payload = {}) {
    if (action === "reply") store.increment("replies");
    if (action === "ignored") store.increment("ignored");
    return { action, ...payload };
  }

  return { handle };
}
