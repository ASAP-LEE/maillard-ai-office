// 실제로 NVIDIA NIM(build.nvidia.com 무료 티어)을 호출해서 레시피/가이드 원고를 만드는 모듈.
// 이 사이트는 정적 사이트(GitHub Pages)라 서버가 없기 때문에,
// API 키는 브라우저(이 탭) 메모리에만 잠깐 저장되고 새로고침하면 사라집니다.
// 즉, 이 화면을 여는 "나"만 자기 키를 넣어서 쓰는 개인용 기능입니다.
// (공개 서비스로 여러 명이 쓰게 하려면 서버가 반드시 필요하고, 이 방식은 쓰면 안 됩니다.)
//
// ⚠️ NVIDIA API는 브라우저에서 직접 호출하면 CORS로 막혀서 "Failed to fetch"가 납니다.
// 그래서 CHAT_COMPLETIONS_URL(aiProxy.ts에 정의된 Vercel 프록시)을 거쳐서 호출해요.

import { CHAT_COMPLETIONS_URL, explainFetchFailure, isProxyConfigured, proxyNotConfiguredError } from "./aiProxy";

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

// build.nvidia.com에서 무료로 쓸 수 있는 OpenAI 호환 모델이에요.
// ⚠️ 70b 모델은 무료 엔드포인트에서 응답이 2분 넘게 걸려 Vercel 타임아웃(504)이 자주 나서
//    훨씬 빠른 8b 모델로 낮췄어요. 품질 대비 속도 이점이 커서 이 용도엔 8b로 충분해요.
const MODEL = "meta/llama-3.1-8b-instruct";

/** 사용자가 준 기획안을 바탕으로 실제 레시피/가이드 원고를 요청하는 프롬프트를 만든다 */
function buildPrompt(input: WriterInput): string {
  return [
    `너는 "마이야르" 고기 콘텐츠 회사의 원고 작성 담당이야.`,
    `이 회사는 "고기 굽는 온도 가이드", "부위별/품종별 고기 소개", "맛 비교·랭킹" 콘텐츠로`,
    `검색 트래픽과 애드센스 수익을 만드는 게 사업이야.`,
    `아래 기획안을 바탕으로 실제로 발행 가능한 글을 한국어로 작성해줘.`,
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
    `- 기획 의도에 맞는 구성을 스스로 판단해서 짤 것`,
    `  (온도 가이드라면 재료→조리법→팁→FAQ→보관법 순, 고기 소개라면 특징→맛→추천 조리법→FAQ 순,`,
    `  비교/랭킹이라면 비교 기준→항목별 비교(표 권장)→상황별 추천→결론 순)`,
    `- 다루는 내용에 맞게 온도·시간·비교 근거 등 구체적인 정보를 반드시 포함할 것`,
    `- 과장된 표현("초간단", "무조건", "국내 유일" 등 근거 없는 과장)은 쓰지 말 것`,
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
        max_tokens: 900,
        temperature: 0.6,
        messages: [{ role: "user", content: buildPrompt(input) }],
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
