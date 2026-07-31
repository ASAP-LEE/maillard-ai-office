// 라이브 오피스의 하루 결과 → 감사팀이 다운로드할 보고서로 변환한다
// 이 정적 사이트(GitHub Pages) 버전은 서버가 없어서 Notion·Discord 같은 외부 서비스로
// 자동 전송하지 않습니다. 대신 감사팀이 직접 받아볼 수 있도록 브라우저에서 바로
// 파일로 다운로드하는 방식만 씁니다 (App.tsx의 downloadTextFile 참고).
import { BLOCK_REASON, type ContentPlan, type Snapshot } from "./sim";
import { BLOCK_NEED, DEPT_BRIEF, DEPT_LEAD } from "./staff";
import { roomOf } from "./world";
import { COMPANY } from "../../company.config";

/** 리스크 / 막힌 부분 — 무엇이 막혔는지 + 어떻게 풀리는지 */
export type RiskItem = {
  team: string;
  issue: string;
  solution: string;
};

/** 팀장이 매일 대표에게 올리는 상세 보고 */
export type TeamReport = {
  deptId: string;
  team: string;
  lead: string;
  status: string;
  today: string;
  risk?: string;
  solution?: string;
  tomorrow: string;
  improve: string;
};

export type DayReport = {
  title: string;
  clock: string;
  phase: string;
  counts: { total: number; done: number; working: number; approval: number; blocked: number };
  highlights: string[];
  /** 오늘 승인 대상 콘텐츠의 상세 제안 — 무엇을 어떻게 만들지 */
  contentProposal: ContentPlan | null;
  decisions: string[];
  risks: RiskItem[];
  next: string[];
  /** 팀별 팀장 일일 상세 보고 */
  teamReports: TeamReport[];
  log: { time: string; text: string }[];
};

/** 보고서 준비 결과 — 저장은 서버가 아니라 브라우저 다운로드로 처리합니다 */
export type PublishResult = {
  ready: boolean;
  detail: string;
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

  const risks: RiskItem[] = entries
    .filter(([, status]) => status === "연동 대기")
    .map(([dept]) => ({
      team: roomOf(dept).name,
      issue: `${BLOCK_NEED[dept] ?? "외부 연동"} 대기로 오늘 진행 불가`,
      solution: BLOCK_REASON[dept] ?? "연동이 완료되는 대로 즉시 재가동합니다.",
    }));

  const decisions = snap.approved
    ? ["TOP 1 콘텐츠 제작 승인 — 대본·제작까지 진행 완료"]
    : snap.approvalPending
      ? ["TOP 1 콘텐츠 승인 여부 (결재 대기 중)"]
      : ["오늘 대표 결재 안건 없음"];

  const next = [
    ...risks.map((risk) => `${risk.team}: 연동 완료되면 즉시 재가동`),
    snap.approved ? "제작된 콘텐츠 업로드 및 성과 기록" : "TOP 3 재검토",
  ];

  const teamReports: TeamReport[] = entries.map(([dept, status]) => {
    const brief = DEPT_BRIEF[dept];
    const lead = DEPT_LEAD[dept];
    const blocked = status === "연동 대기";

    let today: string;
    if (status === "완료") today = brief?.report ?? "오늘 몫을 완료했어요.";
    else if (status === "진행 중") today = `${brief?.task ?? "업무"} 진행 중이에요.`;
    else if (status === "승인 대기") today = "결과물을 올려두고 대표 결재를 기다리는 중이에요.";
    else if (blocked) today = "외부 연동이 안 붙어 있어 오늘은 진행하지 못했어요.";
    else today = "앞 단계 결과물을 기다리는 중이에요.";

    return {
      deptId: dept,
      team: roomOf(dept).name,
      lead: lead?.name ?? "-",
      status,
      today,
      risk: blocked ? (BLOCK_NEED[dept] ?? "외부 연동 대기") : undefined,
      solution: blocked ? (BLOCK_REASON[dept] ?? "연동이 완료되는 대로 즉시 재가동합니다.") : undefined,
      tomorrow: brief?.tomorrow ?? "내일 계획을 정리 중이에요.",
      improve: brief?.improve ?? "보완할 점을 정리 중이에요.",
    };
  });

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
    contentProposal: snap.contentPlan,
    decisions,
    risks,
    next,
    teamReports,
    log: [...snap.log].reverse().map((entry) => ({ time: entry.time, text: `${entry.icon} ${entry.text}` })),
  };
}

/**
 * 정적 사이트(GitHub Pages) 버전에는 서버가 없습니다.
 * Notion·Discord 같은 외부 서비스로 자동 전송하지 않고, 감사팀이 직접 다운로드할 수
 * 있도록 보고서를 준비만 합니다. 실제 파일 저장은 App.tsx의 downloadTextFile()이
 * 브라우저에서 바로 처리합니다 (서버 필요 없음).
 */
export async function publish(_report: DayReport): Promise<PublishResult> {
  return {
    ready: true,
    detail: "보고서 준비 완료 — 감사팀이 다운로드할 수 있어요.",
    publishedAt: new Date().toISOString(),
  };
}

/** 실제 외부 연동은 쓰지 않으므로 항상 비어 있는 상태를 반환합니다 */
export async function fetchIntegrations(): Promise<IntegrationStatus> {
  return {};
}
