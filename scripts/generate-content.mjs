#!/usr/bin/env node
// GitHub Actions 안에서 실행되는 스크립트예요.
// NVIDIA NIM(build.nvidia.com 무료 티어)을 실제로 호출해서 레시피/가이드 원고를 만들고,
// public/content/ 폴더에 날짜별 마크다운 파일로 저장 + public/content/index.json을 갱신합니다.
//
// 필요한 환경변수:
//   NVIDIA_API_KEY   - GitHub 저장소 Settings → Secrets → Actions 에 등록해두면 자동으로 여기 들어와요.
//                       build.nvidia.com에서 발급받은 키(nvapi-로 시작)를 넣으세요.
//
// 입력값(없으면 기본값 사용, workflow_dispatch의 inputs로 전달됨):
//   CONTENT_TITLE, CONTENT_KEYWORD, CONTENT_ANGLE, CONTENT_STEPS(줄바꿈 구분)

import { writeFile, readFile, mkdir } from "node:fs/promises";
import path from "node:path";

const API_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
const MODEL = "meta/llama-3.3-70b-instruct";

const apiKey = process.env.NVIDIA_API_KEY;
if (!apiKey) {
  console.error("NVIDIA_API_KEY가 없어요. GitHub 저장소 Settings → Secrets and variables → Actions 에서 등록해주세요.");
  process.exit(1);
}

const title = process.env.CONTENT_TITLE?.trim() || "고기 굽는 온도 가이드";
const keyword = process.env.CONTENT_KEYWORD?.trim() || "고기 굽는 온도";
const angle = process.env.CONTENT_ANGLE?.trim() ||
  "부위별로 헷갈리는 굽기 온도와 시간을 한눈에 정리해서, 검색하자마자 바로 답을 찾을 수 있게 만드는 콘텐츠.";
const stepsRaw = process.env.CONTENT_STEPS?.trim() ||
  "재료·도구 목록부터 정리\n부위별 권장 온도·시간 표 작성\n실패 방지 팁 3가지\n자주 묻는 질문(FAQ)\n보관법으로 마무리";
const steps = stepsRaw.split("\n").map((s) => s.trim()).filter(Boolean);

function buildPrompt() {
  return [
    `너는 "마이야르" 요리 레시피 SEO 콘텐츠 팀의 원고 작성 담당이야.`,
    `아래 기획안을 바탕으로 실제로 발행 가능한 레시피/가이드 원고를 한국어로 작성해줘.`,
    ``,
    `[기획안]`,
    `제목: ${title}`,
    `타깃 키워드: ${keyword}`,
    `기획 의도: ${angle}`,
    `실행 계획:`,
    ...steps.map((s) => `- ${s}`),
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

async function generate() {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2000,
      temperature: 0.6,
      messages: [{ role: "user", content: buildPrompt() }],
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`API 호출 실패 (${response.status}): ${text.slice(0, 500)}`);
  }

  const data = await response.json();
  const markdown = data.choices?.[0]?.message?.content ?? "";

  if (!markdown.trim()) throw new Error("응답이 비어 있어요.");
  return markdown;
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 40);
}

async function main() {
  const markdown = await generate();

  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const slug = slugify(title) || "content";
  const filename = `${dateStr}-${slug}.md`;

  const contentDir = path.join(process.cwd(), "public", "content");
  await mkdir(contentDir, { recursive: true });

  const frontmatter = [
    "---",
    `title: "${title.replace(/"/g, '\\"')}"`,
    `keyword: "${keyword.replace(/"/g, '\\"')}"`,
    `date: "${dateStr}"`,
    `generatedAt: "${now.toISOString()}"`,
    `model: "${MODEL}"`,
    "---",
    "",
  ].join("\n");

  await writeFile(path.join(contentDir, filename), frontmatter + markdown, "utf-8");

  // index.json 갱신 (목록 페이지가 읽는 파일)
  const indexPath = path.join(contentDir, "index.json");
  let index = [];
  try {
    index = JSON.parse(await readFile(indexPath, "utf-8"));
  } catch {
    index = [];
  }
  index.unshift({ file: filename, title, keyword, date: dateStr, generatedAt: now.toISOString() });
  await writeFile(indexPath, JSON.stringify(index, null, 2), "utf-8");

  console.log(`생성 완료: public/content/${filename}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
