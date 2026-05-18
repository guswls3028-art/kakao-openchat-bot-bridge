/**
 * MessengerBotR-style bridge example.
 *
 * Replace BOT_ENDPOINT and BOT_SECRET, then paste this file into your
 * Android bridge app. Exact function names may differ by app version.
 */

const BOT_ENDPOINT = "https://your-domain.example/events/kakao-message?format=text";
const BOT_SECRET = "change-this-long-random-secret";
const BOT_NICKNAMES = ["오픈채팅봇", "봇계정닉"];

function response(room, msg, sender, isGroupChat, replier) {
  if (!msg || BOT_NICKNAMES.indexOf(sender) >= 0) return;

  try {
    const res = org.jsoup.Jsoup.connect(BOT_ENDPOINT)
      .ignoreContentType(true)
      .ignoreHttpErrors(true)
      .timeout(10000)
      .header("content-type", "application/json")
      .header("x-bot-secret", BOT_SECRET)
      .requestBody(
        JSON.stringify({
          room: room,
          sender: sender,
          text: msg,
          isGroupChat: Boolean(isGroupChat),
        }),
      )
      .post()
      .text();

    if (res && String(res).trim()) replier.reply(String(res).trim());
  } catch (e) {
    // Avoid noisy loops in chat. Check Android app logs for details.
  }
}
