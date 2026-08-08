// ============================================================
//  마이야르 AI 오피스 — NVIDIA NIM 호출용 Vercel 프록시
// ============================================================
//  브라우저(GitHub Pages 정적 사이트)에서 NVIDIA API를 직접 호출하면
//  CORS 정책 때문에 "Failed to fetch"가 납니다.
//  이 파일은 Vercel에 올리면 자동으로 서버리스 함수가 되어,
//  브라우저 → 이 함수(Vercel) → NVIDIA API 순서로 중계해줍니다.
//
//  ⚠️ API 키는 이 함수를 그대로 통과해서 NVIDIA로 전달만 되고, 어디에도 저장되지 않습니다.
//  ⚠️ 배포 후 아래 ALLOWED_ORIGIN을 반드시 내 GitHub Pages 주소로 바꿔서 재배포하세요.
//     (비워두면("*") 아무 사이트나 이 프록시를 갖다 쓸 수 있어서 위험해요)
//     지금은 "*"(전체 허용) 상태입니다 — 먼저 전체 흐름이 정상 작동하는 걸 확인한 뒤,
//     내 GitHub Pages 주소가 확정되면 아래처럼 좁혀서 재배포하세요:
//       const ALLOWED_ORIGIN = "https://asap-lee.github.io";
// ============================================================

// ⚠️ 여기를 실제 GitHub Pages 주소로 바꾸세요 (끝에 / 없이). 예: "https://gitid.github.io"
const ALLOWED_ORIGIN = "*";

const NVIDIA_URL = "https://integrate.api.nvidia.com/v1/chat/completions";

export default async function handler(req, res) {
  const origin = req.headers.origin || "";
  const allow = ALLOWED_ORIGIN === "*" ? "*" : ALLOWED_ORIGIN;

  res.setHeader("Access-Control-Allow-Origin", allow);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type, authorization, accept");

  // 프리플라이트(OPTIONS) 요청 처리
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "POST만 지원합니다." });
    return;
  }

  // 허용된 출처가 아니면 막기 (내 사이트가 아닌 곳에서 도용하는 것 방지)
  if (ALLOWED_ORIGIN !== "*" && origin && origin !== ALLOWED_ORIGIN) {
    res.status(403).json({ error: "허용되지 않은 출처입니다." });
    return;
  }

  const authorization = req.headers["authorization"] || "";
  if (!authorization) {
    res.status(400).json({ error: "authorization 헤더(API 키)가 없습니다." });
    return;
  }

  let bodyStr;
  try {
    bodyStr = JSON.stringify(req.body);
  } catch {
    res.status(400).json({ error: "요청 본문이 올바른 JSON이 아닙니다." });
    return;
  }

  try {
    const upstream = await fetch(NVIDIA_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        authorization,
      },
      body: bodyStr,
    });

    const text = await upstream.text();
    res.status(upstream.status);
    res.setHeader("content-type", "application/json");
    res.send(text);
  } catch (err) {
    res.status(502).json({ error: "NVIDIA 서버 호출에 실패했습니다.", detail: String(err) });
  }
}
