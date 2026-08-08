// src/game/agentPipeline.ts
// 사이트 화면 안에서 실시간으로 돌아가는 "팀장 보고 → 승인/미승인 → 실제 작업" 파이프라인.
// 3단계 AI가 순서대로 실제 NVIDIA NIM을 호출합니다:
//   1) 기획 AI  - 오늘 무엇을 할지 스스로 판단해서 팀장 보고서를 씀
//   2) 작성 AI  - 승인된 기획안으로 실제 원고를 씀
//   3) 검수 AI  - 원고를 실제로 평가해서 통과/반려를 판단
//
// 이 사이트는 정적 사이트라 서버가 없어서, API 키는 브라우저(이 탭) 메모리에만 있다가
// 새로고침하면 사라집니다. 개인 도구로만 쓰세요 (자세한 내용은 aiWriter.ts 상단 설명 참고).
//
// ⚠️ NVIDIA API는 브라우저에서 직접 호출하면 CORS로 막혀서 "Failed to fetch"가 납니다.
// 그래서 CHAT_COMPLETIONS_URL(aiProxy.ts에 정의)을 거쳐서 호출해요.
// 설정 방법은 src/game/aiProxy.ts 파일 상단 주석을 꼭 읽어주세요.

import { CHAT_COMPLETIONS_URL, explainFetchFailure, isProxyConfigured, proxyNotConfiguredError } from "./aiProxy";

// ⚠️ 70b 모델은 무료 엔드포인트에서 응답이 2분 넘게 걸려 Vercel 타임아웃(504)이 자주 나서
//    훨씬 빠른 8b 모델로 낮췄어요.
const MODEL = "meta/llama-3.1-8b-instruct";

async function callModel(apiKey: string, prompt: string, temperature = 0.7): Promise<string> {
  if (!isProxyConfigured()) throw proxyNotConfiguredError();

  // 프록시(Vercel)가 120초에서 강제 종료되므로, 그보다 살짝 짧게 클라이언트에서 먼저
  // 끊어서 "타임아웃"이라는 걸 명확히 알려준다 (그냥 fetch 실패로 뭉개지지 않도록).
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 110_000);

  let response: Response;
  try {
    response = await fetch(CHAT_COMPLETIONS_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        authorization: `Bearer ${apiKey.trim()}`,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1200,
        temperature,
        messages: [{ role: "user", content: prompt }],
      }),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(
        "AI 응답이 110초 안에 오지 않아 중단했어요. NVIDIA 무료 엔드포인트가 혼잡한 것 같아요. 잠시 후 다시 시도해주세요.",
      );
    }
    throw explainFetchFailure();
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    if (response.status === 504) {
      throw new Error(
        "AI 서버 응답이 너무 오래 걸려 시간 초과됐어요 (504). NVIDIA 무료 엔드포인트가 혼잡한 상태일 수 있어요. 잠시 후 다시 시도해주세요.",
      );
    }
    throw new Error(
      `API 호출 실패 (${response.status}). 키가 올바른지, build.nvidia.com에서 사용량이 남아있는지 확인해주세요.\n${text.slice(0, 300)}`,
    );
  }

  const data = await response.json();
  const text: string = data.choices?.[0]?.message?.content ?? "";
  if (!text.trim()) throw new Error("응답이 비어 있어요. 다시 시도해주세요.");
  return text;
}

/** 마크다운 코드펜스나 잡설 없이 JSON만 뽑아내려는 시도 */
function extractJson(raw: string): unknown {
  const cleaned = raw.trim().replace(/^```json\s*|^```\s*|```$/gm, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) {
    // AI가 JSON 형식을 아예 지키지 않고 답한 경우 — 실제로 뭐라고 답했는지 보여줘야
    // 사용자가 원인(거절 멘트, 빈 답변, 다른 언어 등)을 알 수 있다.
    const preview = cleaned.slice(0, 200) || "(빈 응답)";
    throw new Error(`AI 응답에서 JSON을 찾지 못했어요. 실제 응답: "${preview}"`);
  }
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    // { 와 } 는 있지만 그 사이가 잘못된 JSON인 경우 (응답이 중간에 잘렸거나 문법 오류)
    const preview = cleaned.slice(start, Math.min(end + 1, start + 200));
    throw new Error(`AI가 준 JSON 형식이 깨져 있어요. 실제 응답: "${preview}..."`);
  }
}

/**
 * callModel + extractJson을 묶어서, JSON 파싱이 실패하면 "JSON만 답하라"는 지시를
 * 더 강하게 붙여 한 번 더 시도한다. 8b급 소형 모델은 가끔 형식을 안 지킬 때가 있어서
 * (설명을 덧붙이거나, 응답이 중간에 잘리거나) 재시도만으로도 대부분 해결된다.
 */
async function callModelForJson(apiKey: string, prompt: string, temperature = 0.7): Promise<unknown> {
  const raw = await callModel(apiKey, prompt, temperature);
  try {
    return extractJson(raw);
  } catch (firstErr) {
    const retryPrompt = [
      prompt,
      "",
      "⚠️ 방금 답변이 JSON 형식이 아니었어요. 다시 답해주세요.",
      "설명, 인사말, 마크다운 코드펜스(```) 없이 오직 { 로 시작해서 } 로 끝나는 JSON 객체 하나만 출력하세요.",
    ].join("\n");
    const retryRaw = await callModel(apiKey, retryPrompt, Math.min(temperature, 0.3));
    try {
      return extractJson(retryRaw);
    } catch {
      // 재시도까지 실패하면 최초 에러를 그대로 보여준다 (원인 파악에 더 유용)
      throw firstErr;
    }
  }
}

// ---------------------------------------------------------------------------
// 공통: 감사(Audit) 타입 및 규칙 정의
// ---------------------------------------------------------------------------
export type AuditLogEntry = {
  id: string;
  timestamp: string;
  stage: "기획" | "작성" | "검수";
  targetTitle: string;
  passed: boolean;
  feedback: string;
};

export const AUDIT_RULES: Record<"기획" | "작성" | "검수", string[]> = {
  "기획": ["중복된 키워드 방지", "실행 가능한 단계 확인", "과장된 내용 배제"],
  "작성": ["과장된 표현 금지", "마크다운 형식 준수", "도입부 3줄 이내 작성"],
  "검수": ["맞춤법 확인", "카테고리 적합성 평가", "구체적인 수치 포함 여부"],
};

export async function auditStage(
  apiKey: string,
  opts: { leadName: string; stage: "기획" | "작성" | "검수"; content: string; rules: string[] }
): Promise<{ passed: boolean; feedback: string }> {
  const prompt = [
    `너는 "마이야르" 고기 콘텐츠 회사의 감사 담당 ${opts.leadName}이야.`,
    `다음 단계(${opts.stage})의 결과물을 감사해줘.`,
    `[감사 규칙]`,
    ...opts.rules.map((r) => `- ${r}`),
    `[내용]`,
    opts.content.slice(0, 3000),
    `아래 JSON 형식으로만 답해줘 (다른 설명 없이 JSON만):`,
    `{`,
    `  "passed": true 또는 false,`,
    `  "feedback": "통과면 짧은 확인 메시지, 반려면 사유"`,
    `}`
  ].join("\n");

  const parsed = (await callModelForJson(apiKey, prompt, 0.3)) as Partial<{ passed: boolean; feedback: string }>;

  return {
    passed: Boolean(parsed.passed),
    feedback: String(parsed.feedback ?? ""),
  };
}

// ---------------------------------------------------------------------------
// 1단계: 기획 AI
// ---------------------------------------------------------------------------

export type ContentProposal = {
  title: string;
  keyword: string;
  angle: string;
  steps: string[];
  reason: string; // 왜 이 주제를 골랐는지 (팀장 보고용)
  category: string; // "온도가이드" | "고기소개" | "비교랭킹" 등 어떤 종류의 콘텐츠인지
};

// 회사가 실제로 다루는 3가지 콘텐츠 카테고리.
// 기획 AI가 매번 이 중 하나를 스스로 골라서 기획하게 한다.
const CONTENT_CATEGORIES = [
  "온도·시간 가이드 — 부위별로 굽는 온도, 시간, 굽기 정도(레어/미디엄/웰던)를 알려주는 실용 가이드",
  "고기 소개 — 특정 부위나 품종(예: 등심, 안심, 삼겹살, 와규, 한우 등급 등)이 뭐가 특별한지 소개하는 글",
  "맛 비교·랭킹 — 여러 부위나 품종을 비교해서 어떤 게 더 맛있는지, 어떤 상황에 뭐가 더 나은지 정리하는 글",
];

export async function planContent(
  apiKey: string,
  opts: { deptName: string; leadName: string; recentTitles: string[]; instruction?: string },
): Promise<ContentProposal> {
  const avoidList =
    opts.recentTitles.length > 0
      ? `이미 다룬 주제(중복 피할 것): ${opts.recentTitles.join(", ")}`
      : "아직 발행된 글이 없어요.";

  const instructionLine = opts.instruction
    ? `\n[대표 지시사항 — 반드시 반영할 것]\n${opts.instruction}\n`
    : "";

  const prompt = [
    `너는 "마이야르" 고기 콘텐츠 회사의 "${opts.deptName}" 팀장 ${opts.leadName}이야.`,
    `이 회사는 "고기 굽는 온도 가이드"와 "어떤 고기가 유명하고 맛있는지 소개"하는 콘텐츠로`,
    `검색 트래픽과 애드센스 수익을 만드는 게 사업이야.`,
    `오늘 발행할 콘텐츠 기획안을 스스로 정해서 대표에게 보고해야 해.`,
    ``,
    `아래 3가지 콘텐츠 카테고리 중 하나를 골라서 기획해줘 (매번 다양하게 골고루):`,
    ...CONTENT_CATEGORIES.map((c) => `- ${c}`),
    ``,
    avoidList,
    instructionLine,
    `아래 JSON 형식으로만 답해줘 (다른 설명 없이 JSON만):`,
    `{`,
    `  "category": "위 3가지 카테고리 이름 중 하나(짧게, 예: 온도가이드/고기소개/맛비교)",`,
    `  "title": "콘텐츠 제목",`,
    `  "keyword": "타깃 키워드",`,
    `  "angle": "기획 의도 (왜 이 주제, 어떤 각도로 쓸지)",`,
    `  "steps": ["실행계획1", "실행계획2", "실행계획3", "실행계획4"],`,
    `  "reason": "대표에게 보고할 한두 문장 — 왜 오늘 이 주제와 카테고리를 선택했는지"`,
    `}`,
  ].join("\n");

  const parsed = (await callModelForJson(apiKey, prompt, 0.8)) as Partial<ContentProposal>;

  if (!parsed.title || !parsed.keyword || !parsed.angle || !Array.isArray(parsed.steps)) {
    throw new Error("기획 AI 응답 형식이 이상해요. 다시 시도해주세요.");
  }

  return {
    title: String(parsed.title),
    keyword: String(parsed.keyword),
    angle: String(parsed.angle),
    steps: parsed.steps.map((s) => String(s)),
    reason: String(parsed.reason ?? ""),
    category: String(parsed.category ?? "온도가이드"),
  };
}

// ---------------------------------------------------------------------------
// 2단계: 작성 AI
// ---------------------------------------------------------------------------

export async function writeDraft(
  apiKey: string,
  plan: ContentProposal,
  opts: { leadName: string; feedback?: string },
): Promise<string> {
  const feedbackLine = opts.feedback
    ? `\n[검수팀 반려 사유 — 반드시 고칠 것]\n${opts.feedback}\n`
    : "";

  const structureGuide = pickStructureGuide(plan.category);

  const prompt = [
    `너는 "마이야르" 고기 콘텐츠 회사의 원고 작성 담당 ${opts.leadName}이야.`,
    `아래 기획안을 바탕으로 실제로 발행 가능한 글을 한국어로 작성해줘.`,
    ``,
    `[기획안]`,
    `카테고리: ${plan.category}`,
    `제목: ${plan.title}`,
    `타깃 키워드: ${plan.keyword}`,
    `기획 의도: ${plan.angle}`,
    `실행 계획:`,
    ...plan.steps.map((s) => `- ${s}`),
    feedbackLine,
    `[작성 규칙]`,
    `- 마크다운 형식으로 작성 (제목은 #, 소제목은 ##)`,
    `- 도입부는 3줄 이내로 훅을 만들고 바로 핵심으로 들어갈 것`,
    structureGuide,
    `- 과장된 표현("초간단", "무조건", "국내 유일" 등 근거 없는 과장)은 쓰지 말 것`,
    `- 반드시 한국어로만 작성할 것`,
  ].join("\n");

  return callModel(apiKey, prompt, 0.6);
}

/** 콘텐츠 카테고리에 맞는 글 구성 가이드를 고른다 */
function pickStructureGuide(category: string): string {
  if (category.includes("고기소개") || category.includes("고기 소개")) {
    return "- 구성: 이 부위/품종이 뭔지 → 맛과 식감 특징 → 어떻게 먹으면 좋은지(굽기/조리법 추천) → 고를 때 팁 → FAQ 순서로 구성";
  }
  if (category.includes("비교") || category.includes("랭킹")) {
    return "- 구성: 비교 기준 소개 → 항목별 비교(표 형태 권장) → 상황별 추천(가성비/특별한 날 등) → 결론 요약 순서로 구성. 표는 마크다운 테이블로 작성";
  }
  // 기본값: 온도·시간 가이드
  return "- 구성: 재료/도구 목록 → 단계별 조리법(번호) → 실패 방지 팁 → FAQ → 보관법 순서로 구성. 온도·시간·굽기 정도 등 구체적인 수치를 반드시 포함할 것";
}

// ---------------------------------------------------------------------------
// 3단계: 검수 AI
// ---------------------------------------------------------------------------

export type ReviewResult = {
  passed: boolean;
  feedback: string;
};

export async function reviewDraft(
  apiKey: string,
  markdown: string,
  opts: { leadName: string; keyword: string; category?: string },
): Promise<ReviewResult> {
  const prompt = [
    `너는 "마이야르" 고기 콘텐츠 회사의 검수 담당 ${opts.leadName}이야.`,
    `아래 원고가 실제로 발행해도 될 만큼 품질이 충분한지 깐깐하게 평가해줘.`,
    `카테고리: ${opts.category ?? "정보 확인 불가"}`,
    `타깃 키워드 "${opts.keyword}"가 자연스럽게 들어갔는지, 구체적인 정보(수치·비교·근거)가 있는지,`,
    `과장 표현은 없는지, 이 카테고리에 맞는 글 구성이 되어 있는지 확인해줘.`,
    ``,
    `[원고]`,
    markdown.slice(0, 4000),
    ``,
    `아래 JSON 형식으로만 답해줘 (다른 설명 없이 JSON만):`,
    `{`,
    `  "passed": true 또는 false,`,
    `  "feedback": "통과면 짧은 칭찬 한줄, 반려면 구체적으로 무엇을 고쳐야 하는지"`,
    `}`
  ].join("\n");

  const parsed = (await callModelForJson(apiKey, prompt, 0.3)) as Partial<ReviewResult>;

  return {
    passed: Boolean(parsed.passed),
    feedback: String(parsed.feedback ?? ""),
  };
}

// ---------------------------------------------------------------------------
// 전사 부서별 "오늘 할 일" 보고 — 12개 부서 팀장이 각자 실제 AI를 호출해서
// 오늘 할 일을 스스로 정하고 대표에게 보고한다. 대표가 승인/미승인을 결정하고,
// 미승인이면 지시를 내려서 같은 팀장이 지시를 반영해 다시 보고한다.
// ---------------------------------------------------------------------------

export type DeptDailyReport = {
  /** 오늘 할 일 한 줄 요약 (보고 제목) */
  summary: string;
  /** 구체적인 실행 계획 3~5개 */
  steps: string[];
  /** 왜 이렇게 하기로 했는지, 대표에게 보고하는 한두 문장 */
  reason: string;
};

export async function deptDailyReport(
  apiKey: string,
  opts: {
    deptName: string;
    leadName: string;
    task: string;
    instruction?: string;
  },
): Promise<DeptDailyReport> {
  const instructionLine = opts.instruction
    ? `\n[대표 지시사항 — 반드시 반영해서 계획을 다시 짤 것]\n${opts.instruction}\n`
    : "";

  const prompt = [
    `너는 "마이야르" 고기 콘텐츠 회사의 "${opts.deptName}" 팀장 ${opts.leadName}이야.`,
    `이 팀이 평소에 하는 일: ${opts.task}`,
    `오늘 아침 대표에게 보고할 "오늘 할 일" 계획을 스스로 정해서 보고해야 해.`,
    instructionLine,
    `아래 JSON 형식으로만 답해줘 (다른 설명 없이 JSON만):`,
    `{`,
    `  "summary": "오늘 할 일 한 줄 요약",`,
    `  "steps": ["실행계획1", "실행계획2", "실행계획3"],`,
    `  "reason": "대표에게 보고할 한두 문장 — 왜 오늘 이렇게 하기로 했는지"`,
    `}`,
  ].join("\n");

  const parsed = (await callModelForJson(apiKey, prompt, 0.75)) as Partial<DeptDailyReport>;

  if (!parsed.summary || !Array.isArray(parsed.steps)) {
    throw new Error("팀장 보고 응답 형식이 이상해요. 다시 시도해주세요.");
  }

  return {
    summary: String(parsed.summary),
    steps: parsed.steps.map((s) => String(s)),
    reason: String(parsed.reason ?? ""),
  };
}
