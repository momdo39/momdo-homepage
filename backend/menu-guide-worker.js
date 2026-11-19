/**
 * Momdo Gemini Menu Guide - Cloudflare Worker
 * API key must be stored as a Worker Secret named GEMINI_API_KEY.
 * Never place the API key in the frontend or repository.
 */
const ALLOWED_ORIGIN = "https://momdo39.github.io";
const MODEL = "gemini-3.8-flash";
const MAX_MESSAGE_CHARS = 500;
const MAX_HISTORY = 12;
const MAX_HISTORY_CHARS = 500;

const SYSTEM_PROMPT = `
あなたは「Momdo MASSAGE & BODYWORK」のメニュー相談アシスタントです。
目的は、来店を検討している人の悩み・希望・時間・予算を会話で聞き、店舗の実際のメニューから無理のない提案をすることです。押し売りせず、本人の希望と時間・予算を尊重してください。診断や治療効果の保証はしないでください。

【接客方針】
- 最初から料金表を列挙せず、まず悩みや希望を短く聞き取る。
- 90分（メディカルマッサージ ¥9,000）を、複数の悩みや身体全体のバランスを相談したい場合の第一候補として自然に紹介する。
- 75分（¥7,500）を次のおすすめ候補にする。90分が長いと感じる方には、気になる箇所と関連部位を中心に75分を提案する。
- 30分を希望された場合、急いでいる・時間が限られている可能性を考慮し、短時間しか取れない事情がなければ60分（¥6,000）で少し広く確認する選択肢を優しく提案する。30分希望を否定せず、時間制約が明確なら30分を尊重する。
- 60分希望なら60分を基本にし、悩みが複数ある場合のみ75分を選択肢として説明する。
- 75分希望なら75分中心。90分は本人が希望する場合や余裕がある場合に紹介。
- 90分希望なら90分を中心に案内。120分（¥12,000）は時間と希望が合う場合のみ。
- 予算が気になる場合はオーダーメイドコース（メディカルとリラクゼーションの組み合わせ）も案内し、予算に合わせて相談できると伝える。高いコースへ誘導しない。
- 価格を提案するときは時間と料金を正確に明記し、なぜそのコースが合いそうかを1〜2文で説明する。
- 相談は簡潔で自然な日本語。質問は一度に1つ程度。ユーザーが情報を十分に伝えたら、同じ質問を繰り返さず提案する。

【メニューと価格】
メディカルマッサージ：30分 ¥3,000／60分 ¥6,000／75分 ¥7,500／90分 ¥9,000／120分 ¥12,000。
リラクゼーション：15分 ¥1,480／30分 ¥2,480（オーダーメイド組み合わせの枠として案内。単独施術として誤案内しない）。
オーダーメイド組み合わせ：30分メディカル＋30分リラクゼーション ¥5,480／45＋15分 ¥5,980／60＋15分 ¥7,480／60＋30分 ¥8,480／75＋15分 ¥8,980。
ヘッド＆フェイス：15分 ¥1,500／30分 ¥3,000。

【安全面】
- AIは症状の診断をしない。施術で治る、必ず改善するなどと断言しない。
- 急激・非常に強い痛み、事故や外傷後、胸痛、呼吸困難、急な麻痺や脱力、進行するしびれ、発熱を伴う症状などは、施術相談より先に医療機関や緊急窓口へ相談するよう勧める。
- 医療的な判断が必要な場合は医療専門家に相談することを案内する。
- 不安をあおらない。丁寧で落ち着いた接客を行う。

最後に必要な場合だけ、メニューの予約・詳細ページを見るよう案内してください。リンク先を推測で作らないこと。
`;

function jsonResponse(data, status, origin) {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Vary": "Origin"
  };
  if (origin === ALLOWED_ORIGIN) {
    headers["Access-Control-Allow-Origin"] = ALLOWED_ORIGIN;
    headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type";
    headers["Access-Control-Max-Age"] = "86400";
  }
  return new Response(JSON.stringify(data), { status, headers });
}

function cleanHistory(history) {
  if (!Array.isArray(history)) return [];
  return history.slice(-MAX_HISTORY).flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const role = entry.role === "assistant" || entry.role === "model" ? "model" : entry.role === "user" ? "user" : null;
    if (!role || typeof entry.content !== "string") return [];
    const content = entry.content.trim().slice(0, MAX_HISTORY_CHARS);
    return content ? [{ role, parts: [{ text: content }] }] : [];
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    if (origin !== ALLOWED_ORIGIN) {
      return new Response("Forbidden", { status: 403, headers: { "Cache-Control": "no-store" } });
    }

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Max-Age": "86400",
          "Vary": "Origin"
        }
      });
    }

    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/api/menu-guide") {
      return jsonResponse({ error: "Not found" }, 404, origin);
    }
    if (!env.GEMINI_API_KEY) {
      return jsonResponse({ error: "AI service is not configured." }, 503, origin);
    }

    try {
      const contentLength = Number(request.headers.get("Content-Length") || 0);
      if (contentLength > 12000) return jsonResponse({ error: "Request too large." }, 413, origin);

      const body = await request.json();
      if (!body || typeof body.message !== "string") {
        return jsonResponse({ error: "Invalid request." }, 400, origin);
      }
      const message = body.message.trim().slice(0, MAX_MESSAGE_CHARS);
      if (!message) return jsonResponse({ error: "Please enter a message." }, 400, origin);

      let contents = cleanHistory(body.history);
      // Frontend history may already contain the newest message; avoid adding it twice.
      const last = contents[contents.length - 1];
      const lastText = last?.parts?.[0]?.text || "";
      if (!(last?.role === "user" && lastText === message)) {
        contents.push({ role: "user", parts: [{ text: message }] });
      }
      if (!contents.length) contents = [{ role: "user", parts: [{ text: message }] }];

      const apiResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": env.GEMINI_API_KEY
          },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
            contents,
            generationConfig: {
              temperature: 0.65,
              maxOutputTokens: 700
            }
          })
        }
      );

      if (!apiResponse.ok) {
        // Keep provider errors and any API key details out of client responses.
        return jsonResponse({ error: "AI service temporarily unavailable." }, 502, origin);
      }

      const result = await apiResponse.json();
      const reply = result?.candidates?.[0]?.content?.parts
        ?.map((part) => part.text || "")
        .join("")
        .trim();

      if (!reply) return jsonResponse({ error: "AI returned an empty response." }, 502, origin);
      return jsonResponse({ reply }, 200, origin);
    } catch (err) {
      return jsonResponse({ error: "Could not process the request." }, 400, origin);
    }
  }
};
