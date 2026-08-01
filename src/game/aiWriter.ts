// 실제로 NVIDIA NIM(build.nvidia.com 무료 티어)을 호출해서 레시피/가이드 원고를 만드는 모듈.
// 이 사이트는 정적 사이트(GitHub Pages)라 서버가 없기 때문에,
// API 키는 브라우저(이 탭) 메모리에만 잠깐 저장되고 새로고침하면 사라집니다.
// 즉, 이 화면을 여는 "나"만 자기 키를 넣어서 쓰는 개인용 기능입니다.
// (공개 서비스로 여러 명이 쓰게 하려면 서버가 반드시 필요하고, 이 방식은 쓰면 안 됩니다.)

export type WriterInput = {
  /** 원고 팀장이 받은 컨텐츠 기획안 제목 */
  title: string;
  /** 타깃 키워드 (예: "고기 굽는 온도") */
  keyword: string;
  /** 기획 의도/앵글 */
  angle: string;
  /** 실행 계획 단계들 */
  steps: string[];
};

export type WriterResult = {
  markdown: string;
  model: string;
  generatedAt: string;
};

// build.nvidia.com에서 무료로 쓸 수 있는 OpenAI 호환 엔드포인트예요.
const MODEL = "meta/llama-3.3-70b-instruct";
const API_URL = "https://integrate.api.nvidia.com/v1/chat/completions";

/** 사용자가 준 기획안을 바탕으로 실제 레시피/가이드 원고를 요청하는 프롬프트를 만든다 */
function buildPrompt(input: WriterInput): string {
  return [
    `너는 "마이야르" 요리 레시피 SEO 콘텐츠 팀의 원고 작성 담당이야.`,
    `아래 기획안을 바탕으로 실제로 발행 가능한 레시피/가이드 원고를 한국어로 작성해줘.`,
    ``,
    `[기획안]`,
    `제목: ${input.title}`,
    `타깃 키워드: ${input.keyword}`,
    `기획 의도: ${input.angle}`,
    `실행 계획:`,
    ...input.steps.map((s) => `- ${s}`),
    ``,
    `[작성 규칙]`,
    `- 마크다운 형식으로 작성 (제목은 #, 소제목은 ##)`,
    `- 도입부는 3줄 이내로 훅을 만들고 바로 핵심으로 들어갈 것`,
    `- 재료/도구 목록 → 단계별 조리법(번호) → 실패 방지 팁 → FAQ → 보관법 순서로 구성`,
    `- 온도·시간·굽기 정도 등 구체적인 수치를 반드시 포함할 것`,
    `- 과장된 표현("초간단", "무조건" 등)은 쓰지 말 것`,
    `- 검색 사용자가 3초 안에 원하는 답을 찾을 수 있도록 결론부터 명확하게 쓸 것`,
    `- 반드시 한국어로만 작성할 것`,
  ].join("\n");
}

/**
 * NVIDIA NIM API를 직접 호출해서 실제 원고를 생성한다.
 * apiKey는 이 함수를 호출하는 시점에만 쓰이고 어디에도 저장되지 않는다.
 */
export async function generateRecipeDraft(
  apiKey: string,
  input: WriterInput,
): Promise<WriterResult> {
  if (!apiKey.trim()) {
    throw new Error("API 키가 비어 있어요. 먼저 키를 입력해주세요.");
  }

  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      authorization: `Bearer ${apiKey.trim()}`,
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2000,
      temperature: 0.6,
      messages: [{ role: "user", content: buildPrompt(input) }],
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `API 호출 실패 (${response.status}). 키가 올바른지, build.nvidia.com에서 사용량이 남아있는지 확인해주세요.\n${text.slice(0, 300)}`,
    );
  }

  const data = await response.json();
  const markdown: string = data.choices?.[0]?.message?.content ?? "";

  if (!markdown.trim()) {
    throw new Error("응답이 비어 있어요. 다시 시도해주세요 (무료 티어는 혼잡 시 응답이 늦거나 실패할 수 있어요).");
  }

  return {
    markdown,
    model: MODEL,
    generatedAt: new Date().toISOString(),
  };
}
