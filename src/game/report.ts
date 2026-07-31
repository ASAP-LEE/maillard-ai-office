// 라이브 오피스의 하루 결과 → 보고서로 변환한다
// ⚠️ 이 정적 사이트 버전(GitHub Pages)에서는 서버가 없어서
//    Notion·Discord로 실제 발행은 되지 않습니다. 화면 시뮬레이션은 정상 작동합니다.
import type { Snapshot } from "./sim";
import { BLOCK_NEED, DEPT_BRIEF } from "./staff";
import { roomOf } from "./world";
import { COMPANY } from "../../company.config";

export type DayReport = {
  title: string;
  clock: string;
  phase: string;
  counts: { total: number; done: number; working: number; approval: number; blocked: number };
  highlights: string[];
  decisions: string[];
  risks: string[];
  next: string[];
  log: { time: string; text: string }[];
};

export type PublishResult = {
  notion: { ok: boolean; status: string; detail?: string; url?: string };
  discord: { ok: boolean; status: string; detail?: string };
  publishedAt: string;
};

export type IntegrationStatus = Record<
  string,
  { configured: boolean; label: string; need?: string }
>;

export function buildReport(snap: Snapshot): DayReport {
  const entries = Object.entries(snap.deptStatus);

  const highlights = entries
    .filter(([, status]) => status === "완료")
    .map(([dept]) => `${roomOf(dept).name} — ${DEPT_BRIEF[dept]?.report ?? "완료"}`);

  const risks = entries
    .filter(([, status]) => status === "연동 대기")
    .map(([dept]) => `${roomOf(dept).name} — ${BLOCK_NEED[dept] ?? "외부 연동"} 대기로 오늘 진행 불가`);

  const decisions = snap.approved
    ? ["TOP 1 콘텐츠 제작 승인 — 대본·제작까지 진행 완료"]
    : snap.approvalPending
      ? ["TOP 1 콘텐츠 승인 여부 (결재 대기 중)"]
      : ["오늘 대표 결재 안건 없음"];

  const next = [
    ...risks.map((risk) => `${risk.split(" — ")[0]}: 연동 완료되면 즉시 재가동`),
    snap.approved ? "제작된 콘텐츠 업로드 및 성과 기록" : "TOP 3 재검토",
  ];

  return {
    title: `${snap.clock} ${COMPANY.reportName} 일일 브리핑`,
    clock: snap.clock,
    phase: snap.phase,
    counts: {
      total: entries.length,
      done: snap.stats.done,
      working: snap.stats.working,
      approval: snap.stats.approval,
      blocked: snap.stats.blocked,
    },
    highlights,
    decisions,
    risks,
    next,
    log: [...snap.log].reverse().map((entry) => ({ time: entry.time, text: `${entry.icon} ${entry.text}` })),
  };
}

/**
 * 정적 사이트(GitHub Pages) 버전에서는 서버가 없습니다.
 * 실제로 Notion·Discord에 보내고 싶다면 Cloudflare Workers 배포판을 사용하세요.
 * (README의 "5. 진짜 웹사이트로 배포하기" 참고)
 */
export async function publish(_report: DayReport): Promise<PublishResult> {
  return {
    notion: { ok: false, status: "미지원", detail: "정적 사이트 버전에서는 서버 연동이 지원되지 않아요." },
    discord: { ok: false, status: "미지원", detail: "정적 사이트 버전에서는 서버 연동이 지원되지 않아요." },
    publishedAt: new Date().toISOString(),
  };
}

export async function fetchIntegrations(): Promise<IntegrationStatus> {
  return {
    notion: { configured: false, label: "Notion", need: "정적 사이트 버전은 미지원" },
    discord: { configured: false, label: "Discord", need: "정적 사이트 버전은 미지원" },
  };
}
