// 사이트 화면 안에서 실시간으로 돌아가는 "팀장 보고 → 승인/미승인 → 실제 작업" 파이프라인.
// 3단계 AI가 순서대로 실제 NVIDIA NIM을 호출합니다:
//   1) 기획 AI  - 오늘 무엇을 할지 스스로 판단해서 팀장 보고서를 씀
//   2) 작성 AI  - 승인된 기획안으로 실제 원고를 씀
//   3) 검수 AI  - 원고를 실제로 평가해서 통과/반려를 판단
//
// 이 사이트는 정적 사이트라 서버가 없어서, API 키는 브라우저(이 탭) 메모리에만 있다가
// 새로고침하면 사라집니다. 개인 도구로만 쓰세요 (자세한 내용은 aiWriter.ts 상단 설명 참고).

const API_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
const MODEL = "meta/llama-3.3-70b-instruct";

async function callModel(apiKey: string, prompt: string, temperature = 0.7): Promise<string> {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      authorization: `Bearer ${apiKey.trim()}`,
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1500,
      temperature,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
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
  if (start === -1 || end === -1) throw new Error("AI 응답에서 JSON을 찾지 못했어요.");
  return JSON.parse(cleaned.slice(start, end + 1));
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

  const raw = await callModel(apiKey, prompt, 0.8);
  const parsed = extractJson(raw) as Partial<ContentProposal>;

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
    `}`,
  ].join("\n");

  const raw = await callModel(apiKey, prompt, 0.3);
  const parsed = extractJson(raw) as Partial<ReviewResult>;

  return {
    passed: Boolean(parsed.passed),
    feedback: String(parsed.feedback ?? ""),
  };
}
