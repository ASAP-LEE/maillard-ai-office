// ============================================================
//  마이야르 AI 오피스 — Google Search Console 연동용 Vercel 함수
// ============================================================
//  이 파일은 Vercel에 배포되면 서버리스 함수(/api/search-console)가 됩니다.
//  브라우저(GitHub Pages 정적 사이트) → 이 함수(Vercel) → Google Search Console API
//  순서로 중계합니다. 브라우저가 Google 서비스 계정 키를 직접 들고 있으면 개발자 도구로
//  누구나 훔쳐볼 수 있기 때문에, 키는 반드시 이 서버(Vercel 환경변수)에만 있어야 합니다.
//
//  ⚠️ 이 함수는 nvidia-proxy.js와 성격이 다릅니다:
//     nvidia-proxy는 "브라우저가 들고 온 API 키"를 그대로 중계만 합니다 (프록시가 키를 모름).
//     이 함수는 "서버 자신이 비밀 키를 들고" Google에 인증합니다. 그래서 이 프록시 주소를
//     아는 사람은 누구나 내 검색 데이터를 볼 수 있게 되므로, 자체 토큰(GSC_PROXY_TOKEN)으로
//     한 번 더 잠급니다. 아래 "필요한 환경변수" 참고.
//
//  ------------------------------------------------------------
//  필요한 환경변수 (Vercel 프로젝트 설정 → Environment Variables)
//  ------------------------------------------------------------
//   GSC_CLIENT_EMAIL   서비스 계정 이메일 (xxx@xxx.iam.gserviceaccount.com)
//   GSC_PRIVATE_KEY    서비스 계정 JSON의 private_key 값 그대로
//                       (Vercel 입력창에 줄바꿈 포함해서 그대로 붙여넣으면 됩니다.
//                        만약 한 줄로만 입력해야 한다면 \n 이스케이프 문자를 써도 되고,
//                        이 함수가 자동으로 \n을 실제 줄바꿈으로 바꿔줍니다.)
//   GSC_SITE_URL       Search Console에 등록된 속성 주소
//                       예: "https://example.com/" 또는 "sc-domain:example.com"
//   GSC_PROXY_TOKEN     이 프록시를 호출할 때 요구할 임의의 비밀 토큰 (직접 아무 문자열이나 생성).
//                       프론트엔드도 같은 값을 알아야 합니다 (searchConsoleProxy.ts 참고).
//   GSC_ALLOWED_ORIGIN  (선택) 이 프록시를 호출할 수 있는 출처. 비워두면 전체 허용("*").
//                       배포 후 내 GitHub Pages 주소로 좁히는 걸 권장합니다.
//
//  이 중 하나라도 비어 있으면, 이 함수는 502가 아니라 명확한 configuration_error를
//  돌려줘서 "무엇이 안 되어 있는지" 프론트엔드가 사용자에게 정확히 보여줄 수 있게 합니다.
// ============================================================

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SEARCH_ANALYTICS_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

/** 환경변수 하나라도 비어 있으면 어떤 게 비었는지 모아서 반환 */
function checkConfig() {
  const missing = [];
  if (!process.env.GSC_CLIENT_EMAIL) missing.push("GSC_CLIENT_EMAIL");
  if (!process.env.GSC_PRIVATE_KEY) missing.push("GSC_PRIVATE_KEY");
  if (!process.env.GSC_SITE_URL) missing.push("GSC_SITE_URL");
  if (!process.env.GSC_PROXY_TOKEN) missing.push("GSC_PROXY_TOKEN");
  return missing;
}

function base64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * 서비스 계정 JSON 키로 Google OAuth2용 JWT를 직접 서명한다 (RS256).
 * 외부 라이브러리(googleapis, jsonwebtoken) 없이 Node 내장 crypto만 사용해서
 * 이 프로젝트의 "의존성 최소" 원칙을 유지한다.
 */
async function signServiceAccountJwt() {
  const crypto = await import("node:crypto");

  const clientEmail = process.env.GSC_CLIENT_EMAIL;
  // Vercel 환경변수 입력 방식에 따라 \n이 이스케이프 문자로 들어올 수 있어 실제 줄바꿈으로 되돌린다.
  const privateKey = (process.env.GSC_PRIVATE_KEY || "").replace(/\\n/g, "\n");

  const header = { alg: "RS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const claimSet = {
    iss: clientEmail,
    scope: SEARCH_ANALYTICS_SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  };

  const encodedHeader = base64url(JSON.stringify(header));
  const encodedClaim = base64url(JSON.stringify(claimSet));
  const signingInput = `${encodedHeader}.${encodedClaim}`;

  const signer = crypto.createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(privateKey);
  const encodedSignature = signature
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  return `${signingInput}.${encodedSignature}`;
}

/** 서명된 JWT를 Google에 교환해서 access_token을 받는다 */
async function getAccessToken() {
  const assertion = await signServiceAccountJwt();

  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion,
  });

  const resp = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  const data = await resp.json().catch(() => null);

  if (!resp.ok || !data?.access_token) {
    const reason = data?.error_description || data?.error || `HTTP ${resp.status}`;
    const err = new Error(`Google 인증 실패: ${reason}`);
    err.kind = "auth_error";
    err.status = 401;
    throw err;
  }

  return data.access_token;
}

/** YYYY-MM-DD 형식인지 아주 단순하게 검증 (완벽한 달력 검증은 아니고, 명백한 오입력만 거른다) */
function isValidDateStr(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

const VALID_DIMENSIONS = new Set(["query", "page", "country", "device", "date", "searchAppearance"]);

function validateQuery(payload) {
  const problems = [];

  const { startDate, endDate, dimensions, rowLimit, startRow } = payload || {};

  if (!isValidDateStr(startDate)) problems.push("startDate는 YYYY-MM-DD 형식이어야 합니다.");
  if (!isValidDateStr(endDate)) problems.push("endDate는 YYYY-MM-DD 형식이어야 합니다.");
  if (isValidDateStr(startDate) && isValidDateStr(endDate) && startDate > endDate) {
    problems.push("startDate가 endDate보다 늦을 수 없습니다.");
  }

  if (dimensions !== undefined) {
    if (!Array.isArray(dimensions) || dimensions.length === 0) {
      problems.push("dimensions는 비어 있지 않은 배열이어야 합니다.");
    } else if (dimensions.some((d) => !VALID_DIMENSIONS.has(d))) {
      problems.push(`dimensions는 다음 중에서만 골라야 합니다: ${[...VALID_DIMENSIONS].join(", ")}`);
    }
  }

  if (rowLimit !== undefined) {
    if (!Number.isInteger(rowLimit) || rowLimit < 1 || rowLimit > 25000) {
      problems.push("rowLimit은 1~25000 사이의 정수여야 합니다.");
    }
  }

  if (startRow !== undefined) {
    if (!Number.isInteger(startRow) || startRow < 0) {
      problems.push("startRow는 0 이상의 정수여야 합니다.");
    }
  }

  return problems;
}

/** Search Console Search Analytics API 호출 */
async function querySearchAnalytics(accessToken, payload) {
  const siteUrl = process.env.GSC_SITE_URL;
  const endpoint = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(
    siteUrl,
  )}/searchAnalytics/query`;

  const requestBody = {
    startDate: payload.startDate,
    endDate: payload.endDate,
    dimensions: payload.dimensions ?? ["date"],
    rowLimit: payload.rowLimit ?? 100,
    startRow: payload.startRow ?? 0,
    ...(payload.dimensionFilterGroups ? { dimensionFilterGroups: payload.dimensionFilterGroups } : {}),
  };

  const resp = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(requestBody),
  });

  const text = await resp.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    const err = new Error("Search Console 응답을 해석할 수 없습니다.");
    err.kind = "upstream_error";
    err.status = 502;
    throw err;
  }

  if (!resp.ok) {
    const reason = data?.error?.message || `HTTP ${resp.status}`;
    const err = new Error(`Search Console API 오류: ${reason}`);
    // Google이 401/403을 주면 대부분 서비스 계정이 GSC 속성에 사용자로 추가되지 않은 경우다.
    err.kind = resp.status === 401 || resp.status === 403 ? "auth_error" : "upstream_error";
    err.status = resp.status;
    throw err;
  }

  return data;
}

/** rows 배열을 클릭수/노출수/CTR/평균순위 요약 + 항목별 상세로 가공한다 */
function summarize(data, dimensions) {
  const rows = data.rows || [];

  const totals = rows.reduce(
    (acc, row) => {
      acc.clicks += row.clicks || 0;
      acc.impressions += row.impressions || 0;
      return acc;
    },
    { clicks: 0, impressions: 0 },
  );

  const ctr = totals.impressions > 0 ? totals.clicks / totals.impressions : 0;
  // 평균 순위는 impressions 가중 평균이 정확하다 (row 단순 평균은 왜곡됨)
  const weightedPositionSum = rows.reduce((sum, row) => sum + (row.position || 0) * (row.impressions || 0), 0);
  const avgPosition = totals.impressions > 0 ? weightedPositionSum / totals.impressions : 0;

  const items = rows.map((row) => ({
    keys: row.keys || [],
    clicks: row.clicks || 0,
    impressions: row.impressions || 0,
    ctr: row.ctr ?? (row.impressions ? row.clicks / row.impressions : 0),
    position: row.position || 0,
  }));

  return {
    dimensions,
    totals: {
      clicks: totals.clicks,
      impressions: totals.impressions,
      ctr,
      position: avgPosition,
    },
    rowCount: items.length,
    items,
  };
}

export default async function handler(req, res) {
  const origin = req.headers.origin || "";
  const allowedOrigin = process.env.GSC_ALLOWED_ORIGIN || "*";

  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type, authorization, accept");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "POST" && req.method !== "GET") {
    res.status(405).json({ ok: false, kind: "bad_request", error: "GET 또는 POST만 지원합니다." });
    return;
  }

  if (allowedOrigin !== "*" && origin && origin !== allowedOrigin) {
    res.status(403).json({ ok: false, kind: "forbidden", error: "허용되지 않은 출처입니다." });
    return;
  }

  // ── ① 환경변수 확인 ──────────────────────────────────────
  const missing = checkConfig();
  if (missing.length > 0) {
    res.status(503).json({
      ok: false,
      kind: "configuration_error",
      error: "Search Console 연동에 필요한 환경변수가 설정되지 않았습니다.",
      missing,
    });
    return;
  }

  // ── ② 자체 프록시 토큰 확인 (Google 키와 별개의 보호막) ─────
  const authHeader = req.headers["authorization"] || "";
  const providedToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (providedToken !== process.env.GSC_PROXY_TOKEN) {
    res.status(401).json({
      ok: false,
      kind: "auth_error",
      error: "인증되지 않은 요청입니다. GSC_PROXY_TOKEN이 일치하지 않습니다.",
    });
    return;
  }

  // ── ③ 요청 파싱 ──────────────────────────────────────────
  // GET은 health-check(연결 상태만 확인)용, POST는 실제 조회용.
  let payload = {};
  if (req.method === "POST") {
    try {
      payload = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    } catch {
      res.status(400).json({ ok: false, kind: "bad_request", error: "요청 본문이 올바른 JSON이 아닙니다." });
      return;
    }
  }

  const isHealthCheck = req.method === "GET" || payload.mode === "status";

  try {
    // GET(status)일 때는 토큰 발급까지만 확인해서 "인증이 되는지"만 검증하고 끝낸다.
    if (isHealthCheck) {
      await getAccessToken();
      res.status(200).json({
        ok: true,
        kind: "status",
        connected: true,
        siteUrl: process.env.GSC_SITE_URL,
        checkedAt: new Date().toISOString(),
      });
      return;
    }

    // ── ④ 조회 파라미터 검증 ────────────────────────────────
    const problems = validateQuery(payload);
    if (problems.length > 0) {
      res.status(400).json({ ok: false, kind: "bad_request", error: "요청 파라미터가 올바르지 않습니다.", problems });
      return;
    }

    const accessToken = await getAccessToken();
    const data = await querySearchAnalytics(accessToken, payload);
    const summary = summarize(data, payload.dimensions ?? ["date"]);

    res.status(200).json({
      ok: true,
      kind: "search_analytics",
      siteUrl: process.env.GSC_SITE_URL,
      query: {
        startDate: payload.startDate,
        endDate: payload.endDate,
        dimensions: payload.dimensions ?? ["date"],
      },
      ...summary,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    const kind = err.kind || "upstream_error";
    const status = err.status || 502;
    res.status(status).json({
      ok: false,
      kind,
      connected: kind === "auth_error" ? false : undefined,
      error: err.message || "Search Console 호출 중 알 수 없는 오류가 발생했습니다.",
    });
  }
}
