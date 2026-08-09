import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import OfficeWorld from "./game/OfficeWorld";
import { generateRecipeDraft, type WriterResult } from "./game/aiWriter";
import {
  auditStage,
  deptDailyReport,
  planContent,
  reviewDraft,
  writeDraft,
  AUDIT_RULES,
  type AuditLogEntry,
  type ContentProposal,
  type DeptDailyReport,
  type ReviewResult,
} from "./game/agentPipeline";
import { addAuditEntry, getAuditEntries, nextAuditId, subscribeAudit } from "./game/auditStore";
import {
  buildReport,
  fetchIntegrations,
  publish,
  type DayReport,
  type IntegrationStatus,
  type PublishResult,
} from "./game/report";
import { Company, PHASES, type Agent, type DeptStatus, type Snapshot } from "./game/sim";
import { CEO, DEPT_BRIEF, DEPT_LEAD, STAFF } from "./game/staff";
import { DEPT_ROOMS } from "./game/world";
import { COMPANY, GITHUB_REPO, STORAGE_LINK } from "../company.config";
import {
  loadSearchConsoleData,
  refreshSearchConsoleConnection,
  searchConsoleConnectionStore,
  searchConsolePanelStore,
  useStore as useSearchConsoleStore,
} from "./game/searchConsoleStore";

type View = "live" | "dashboard" | "articles" | "company";

/** DayReport를 사람이 읽기 좋은 텍스트로 바꾼다 */
function reportToText(report: DayReport): string {
  const lines: string[] = [];
  lines.push(`${report.title}`);
  lines.push(`생성 시각: ${new Date().toLocaleString("ko-KR")}`);
  lines.push(`현재 시각(사무실 기준): ${report.clock} · ${report.phase}`);
  lines.push("");
  lines.push(
    `[진행 현황] 전체 ${report.counts.total} · 완료 ${report.counts.done} · 진행중 ${report.counts.working} · 승인대기 ${report.counts.approval} · 연동대기 ${report.counts.blocked}`,
  );
  lines.push("");

  lines.push("■ 오늘의 하이라이트");
  lines.push(report.highlights.length ? report.highlights.map((h) => `- ${h}`).join("\n") : "- (아직 없음)");
  lines.push("");

  lines.push("■ 오늘의 콘텐츠 제안 (무엇을, 어떻게 만들지)");
  if (report.contentProposal) {
    const p = report.contentProposal;
    lines.push(`- 제목: ${p.title} (채점 ${p.score}점)`);
    lines.push(`- 타깃 키워드: ${p.keyword}`);
    lines.push(`- 기획 의도: ${p.angle}`);
    lines.push("- 실행 계획:");
    lines.push(p.steps.map((s) => `  · ${s}`).join("\n"));
  } else {
    lines.push("- 아직 확정된 콘텐츠 제안이 없어요.");
  }
  lines.push("");

  lines.push("■ 결재/의사결정");
  lines.push(report.decisions.map((d) => `- ${d}`).join("\n"));
  lines.push("");

  lines.push("■ 리스크 / 막힌 부분 (해결 방법 포함)");
  lines.push(
    report.risks.length
      ? report.risks
          .map((r) => `- ${r.team}: ${r.issue}\n  → 해결 방법: ${r.solution}`)
          .join("\n")
      : "- (없음)",
  );
  lines.push("");

  lines.push("■ 다음 할 일");
  lines.push(report.next.map((n) => `- ${n}`).join("\n"));
  lines.push("");

  lines.push("■ 팀별 팀장 일일 보고 (오늘 한 일 · 내일 계획 · 보완할 점)");
  lines.push(
    report.teamReports
      .map((t) => {
        const parts = [`- ${t.team} (팀장 ${t.lead}) · 상태: ${t.status}`, `  오늘: ${t.today}`];
        if (t.risk) parts.push(`  리스크: ${t.risk} → 해결 방법: ${t.solution}`);
        parts.push(`  내일 계획: ${t.tomorrow}`);
        parts.push(`  보완할 점: ${t.improve}`);
        return parts.join("\n");
      })
      .join("\n\n"),
  );
  lines.push("");

  lines.push("■ 전체 로그");
  lines.push(report.log.length ? report.log.map((l) => `[${l.time}] ${l.text}`).join("\n") : "- (로그 없음)");
  lines.push("");

  const kindLabel: Record<string, string> = {
    briefing: "보고",
    approved: "승인",
    rejected: "반려",
    instruction: "지시",
    meeting: "회의",
  };
  lines.push("■ 회의·보고 기록 (몇 시에 · 누가 · 무슨 내용을 말했는지)");
  lines.push(
    report.meetingLog.length
      ? report.meetingLog
          .map((m) => `[${m.time}] (${kindLabel[m.kind] ?? m.kind}) ${m.deptName} · ${m.speaker}: “${m.text}”`)
          .join("\n")
      : "- (오늘 진행된 회의·보고 기록 없음)",
  );
  lines.push("");

  return lines.join("\n");
}

/** 문자열을 .txt 파일로 즉시 다운로드한다 (서버 없이 브라우저에서 처리) */
function downloadTextFile(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** 마크다운 원고를 .md 파일로 다운로드한다 */
function downloadMarkdownFile(filename: string, markdown: string) {
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const statusClass: Record<DeptStatus, string> = {
  "완료": "done",
  "진행 중": "working",
  "승인 대기": "approval",
  "연동 대기": "blocked",
  "대기": "waiting",
};

/** 링크만 걸려 있는 항목 (서버 연동과 무관) */
const integrations2Static = STORAGE_LINK
  ? [{ name: "결과물 보관함", status: "링크 연결", tone: "mint", href: STORAGE_LINK }]
  : [];

function PixelEmployee({ hair, shirt, accent }: { hair: string; shirt: string; accent: string }) {
  const style = {
    "--pixel-hair": hair,
    "--pixel-shirt": shirt,
    "--pixel-accent": accent,
  } as CSSProperties;
  return (
    <span className="pixel-employee" style={style} aria-hidden="true">
      <i className="pixel-shadow" />
      <i className="pixel-legs" />
      <i className="pixel-body" />
      <i className="pixel-arm left" />
      <i className="pixel-arm right" />
      <i className="pixel-face">
        <b className="pixel-eyes" />
      </i>
      <i className="pixel-hair" />
      <i className="pixel-headset" />
    </span>
  );
}

export default function Home() {
  const [engine] = useState(() => new Company());
  const [snap, setSnap] = useState<Snapshot>(() => engine.snapshot());
  const [view, setView] = useState<View>("live");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);
  const [briefing, setBriefing] = useState(false);
  const [filter, setFilter] = useState<"전체" | DeptStatus>("전체");
  const [toast, setToast] = useState("");
  const [integrations, setIntegrations] = useState<IntegrationStatus | null>(null);
  const [publishState, setPublishState] = useState<{ busy: boolean; result: PublishResult | null; error: string }>({
    busy: false,
    result: null,
    error: "",
  });
  const publishedRef = useRef(false);
  const [autoLoop, setAutoLoop] = useState(false);
  const [dayCount, setDayCount] = useState(1);
  const autoLoopRef = useRef(autoLoop);
  autoLoopRef.current = autoLoop;

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const loop = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      engine.tick(dt);
      acc += dt;
      if (acc >= 0.18) {
        acc = 0;
        setSnap(engine.snapshot());
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [engine]);

  useEffect(() => {
    engine.setBriefingHandler(() => setBriefing(true));
    return () => engine.setBriefingHandler(null);
  }, [engine]);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2400);
  }, []);

  const onSelect = useCallback((agent: Agent) => setSelectedId(agent.id), []);

  const downloadReport = useCallback(() => {
    const report = buildReport(engine.snapshot());
    const dateStr = new Date().toISOString().slice(0, 10);
    downloadTextFile(`${COMPANY.reportName}_보고서_${dateStr}.txt`, reportToText(report));
    showToast("보고서를 다운로드했어요");
  }, [engine, showToast]);

  // 연동 설정 여부를 서버에서 받아온다 (값이 아니라 설정 여부만)
  useEffect(() => {
    fetchIntegrations()
      .then(setIntegrations)
      .catch(() => setIntegrations(null));
  }, []);

  // Search Console이 실제로 연결됐는지 확인한다. 반드시 서버(Vercel 함수)가 Google
  // 인증에 실제로 성공했다는 응답을 받은 경우에만 SEO 분석팀의 "연동 대기"를 해제한다.
  // 확인에 실패하거나 아직 설정 전이면 아무것도 바꾸지 않고 기존처럼 "연동 대기"로 둔다.
  useEffect(() => {
    let cancelled = false;
    refreshSearchConsoleConnection().then((status) => {
      if (cancelled) return;
      engine.setIntegrationConnected("brand", status.connected);
      if (status.connected) {
        void loadSearchConsoleData();
      }
    });
    return () => {
      cancelled = true;
    };
  }, [engine]);

  const sendReport = useCallback(
    async (auto: boolean) => {
      setPublishState((state) => ({ ...state, busy: true, error: "" }));
      try {
        const result = await publish(buildReport(engine.snapshot()));
        setPublishState({ busy: false, result, error: "" });

        engine.pushLog("📦", "오늘자 보고서 준비 완료 — 감사팀 다운로드 가능", "mint");
        engine.pushChat(
          "staff",
          "김세리",
          "보고서 발행 결과입니다.\n· 감사팀이 확인할 수 있도록 보고서를 준비해 뒀어요.\n· 위쪽 '📥 보고서 다운로드' 버튼을 누르면 오늘자 보고서를 받을 수 있어요.",
        );
        if (!auto) showToast("보고서를 준비했어요 — 감사팀이 다운로드할 수 있어요");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setPublishState({ busy: false, result: null, error: message });
        engine.pushLog("⚠️", `완료 보고 발행 실패 — ${message}`, "lav");
        if (!auto) showToast("발행 실패 — 연동 설정을 확인해주세요");
      }
    },
    [engine, showToast],
  );

  // 하루가 끝나면 자동으로 한 번 발행한다 (+ 자동 반복 모드면 보고서 다운로드 후 바로 다음날 출근)
  useEffect(() => {
    if (snap.dayComplete && !publishedRef.current) {
      publishedRef.current = true;
      void sendReport(true);

      if (autoLoopRef.current) {
        const report = buildReport(engine.snapshot());
        const dateStr = new Date().toISOString().slice(0, 10);
        downloadTextFile(`${COMPANY.reportName}_보고서_${dayCount}일차_${dateStr}.txt`, reportToText(report));

        // 잠깐 숨 돌린 뒤(직원들 라운지 연출 감상 시간) 바로 다음날을 시작한다
        window.setTimeout(() => {
          if (!autoLoopRef.current) return;
          engine.start();
          setDayCount((n) => n + 1);
          publishedRef.current = false;
        }, 4000);
      }
    }
    if (!snap.dayComplete && snap.running) publishedRef.current = false;
  }, [snap.dayComplete, snap.running, sendReport, engine, dayCount]);

  // 자동 반복 모드일 때는 "대표 승인" 대기가 뜨면 자동으로 승인해서 멈추지 않게 한다
  useEffect(() => {
    if (autoLoop && snap.approvalPending) {
      const timer = window.setTimeout(() => engine.approve(), 1200);
      return () => window.clearTimeout(timer);
    }
  }, [autoLoop, snap.approvalPending, engine]);

  const askAgent = useCallback(
    (agent: Agent) => {
      engine.command(`${agent.name} 지금 뭐해?`);
      setSelectedId(null);
      window.setTimeout(
        () => document.getElementById("ceo-console")?.scrollIntoView({ behavior: "smooth", block: "center" }),
        60,
      );
    },
    [engine],
  );

  const start = () => {
    engine.start();
    setBriefing(false);
    setView("live");
    setDayCount(1);
    showToast("07:00 — AI 직원 32명이 출근합니다 ✨");
  };

  const toggleAutoLoop = () => {
    setAutoLoop((v) => {
      const next = !v;
      showToast(next ? "🔁 무한 반복 모드 ON — 하루가 끝나면 자동으로 다음날이 시작돼요" : "🔁 무한 반복 모드 OFF");
      return next;
    });
  };

  const approve = () => {
    engine.approve();
    showToast("승인 완료! 제작팀이 바로 움직여요");
  };

  const teams = useMemo(
    () =>
      DEPT_ROOMS.map((room) => {
        const lead = DEPT_LEAD[room.id];
        const status = snap.deptStatus[room.id] ?? "대기";
        return {
          id: room.id,
          icon: room.icon,
          name: room.name,
          room: room.short,
          lead,
          status,
          ...DEPT_BRIEF[room.id],
        };
      }),
    [snap.deptStatus],
  );

  const filteredTeams = filter === "전체" ? teams : teams.filter((team) => team.status === filter);
  const selected = selectedId ? engine.agentById.get(selectedId) ?? null : null;
  const todo = snap.approvalPending ? 1 : 0;
  const onDuty = engine.agents.filter((a) => a.status !== "출근 전").length;

  return (
    <main className="page-shell">
      <div className="wrap">
        <nav className="app-nav" aria-label="AI Company 화면 전환">
          <div className="brand-chip">
            <span>{COMPANY.logoLetter}</span>
            <b>{COMPANY.name}</b>
          </div>
          <div className="nav-tabs">
            <button className={view === "live" ? "active" : ""} onClick={() => setView("live")}>
              🎮 라이브 오피스
            </button>
            <button className={view === "dashboard" ? "active" : ""} onClick={() => setView("dashboard")}>
              📊 대시보드
            </button>
            <button className={view === "articles" ? "active" : ""} onClick={() => setView("articles")}>
              📰 실제 발행된 원고
            </button>
            <button className={view === "company" ? "active" : ""} onClick={() => setView("company")}>
              🏢 실시간 진짜 회사
            </button>
            <button
              className={`todo-tab ${todo ? "urgent" : ""}`}
              onClick={() => {
                setView("live");
                window.setTimeout(
                  () => document.getElementById("ceo-approval")?.scrollIntoView({ behavior: "smooth", block: "center" }),
                  60,
                );
              }}
            >
              📋 대표 할 일 <i>{todo}</i>
            </button>
          </div>
        </nav>

        {view === "live" ? (
          <LiveView
            engine={engine}
            snap={snap}
            follow={follow}
            setFollow={setFollow}
            selectedId={selectedId}
            onSelect={onSelect}
            onStart={start}
            onApprove={approve}
            onDuty={onDuty}
            onPublish={() => void sendReport(false)}
            onDownload={downloadReport}
            publishBusy={publishState.busy}
            publishResult={publishState.result}
            autoLoop={autoLoop}
            onToggleAutoLoop={toggleAutoLoop}
            dayCount={dayCount}
          />
        ) : view === "dashboard" ? (
          <DashboardView
            teams={teams}
            filteredTeams={filteredTeams}
            filter={filter}
            setFilter={setFilter}
            snap={snap}
            onStart={start}
            onApprove={approve}
            onSelect={(id) => setSelectedId(id)}
            integrations={integrations}
            publishResult={publishState.result}
          />
        ) : view === "articles" ? (
          <ArticlesView />
        ) : (
          <>
            <DeptApprovalPipeline engine={engine} />
            <AutonomousTeamPipeline engine={engine} />
          </>
        )}

        <footer>
          이 툴은 갓생맘 🎀이 만들었어요
          <br />
          <a href="https://www.instagram.com/godseng.mom/" target="_blank" rel="noreferrer">
            📷 @godseng.mom — 더 많은 크리에이터 툴 보러가기 →
          </a>
          <br />© godseng.mom · 자유롭게 쓰되 무단 재판매 금지
        </footer>
      </div>

      {selected ? (
        <ProfileModal
          agent={selected}
          onClose={() => setSelectedId(null)}
          onAsk={(agent) => {
            setView("live");
            askAgent(agent);
          }}
        />
      ) : null}
      {briefing ? <BriefingModal snap={snap} onClose={() => setBriefing(false)} /> : null}
      <div className={`toast ${toast ? "show" : ""}`} role="status">
        {toast}
      </div>
    </main>
  );
}

/**
 * 원고 작성팀이 "실제로" NVIDIA NIM(build.nvidia.com 무료 티어)을 호출해서 진짜 레시피 원고를 쓰는 패널.
 * 이 사이트는 서버가 없는 정적 사이트라, API 키는 이 탭이 열려 있는 동안만
 * 메모리(React state)에 있다가 새로고침하면 사라집니다. 어디에도 저장되지 않아요.
 */
/**
 * 팀장이 실제로 와서(실시간 AI 호출) 오늘 할 일을 보고하고,
 * 대표가 승인하면 다음 단계로, 미승인하면 지시를 받아서 다시 보고하는 파이프라인.
 * 기획팀 → 원고팀 → 검수팀 순서로 진행되고, 검수팀이 반려하면 원고팀이 다시 씀.
 */
type PipelineStage = "briefing" | "working" | "reviewing" | "done";

type PipelineState = {
  stage: PipelineStage;
  proposal: ContentProposal | null;
  draft: string | null;
  review: ReviewResult | null;
  busy: boolean;
  error: string;
  showInstructionBox: boolean;
  instruction: string;
  retryCount: number;
};

const INITIAL_PIPELINE_STATE: PipelineState = {
  stage: "briefing",
  proposal: null,
  draft: null,
  review: null,
  busy: false,
  error: "",
  showInstructionBox: false,
  instruction: "",
  retryCount: 0,
};

/**
 * 12개 부서 전체를 순서대로 도는 "오늘 할 일" 승인 파이프라인.
 * 부서 차례가 되면 팀장이 실제 NVIDIA NIM을 호출해서 오늘 할 일을 스스로 정해 보고하고,
 * 대표가 승인하면 다음 부서로 넘어가고, 미승인하면 지시를 받아서 같은 팀장이 다시 보고한다.
 */
type DeptApprovalState = {
  deptIndex: number;
  report: DeptDailyReport | null;
  busy: boolean;
  error: string;
  showInstructionBox: boolean;
  instruction: string;
  approvedCount: number;
};

const INITIAL_DEPT_APPROVAL_STATE: DeptApprovalState = {
  deptIndex: 0,
  report: null,
  busy: false,
  error: "",
  showInstructionBox: false,
  instruction: "",
  approvedCount: 0,
};

function DeptApprovalPipeline({ engine }: { engine: Company }) {
  const [apiKey, setApiKey] = useState("");
  const [showKeyField, setShowKeyField] = useState(true);
  const [state, setState] = useState<DeptApprovalState>(INITIAL_DEPT_APPROVAL_STATE);
  const [history, setHistory] = useState<{ dept: string; summary: string }[]>([]);

  const depts = DEPT_ROOMS; // company.config.ts DEPARTMENTS 순서 그대로
  const currentDept = depts[state.deptIndex] ?? null;
  const lead = currentDept ? DEPT_LEAD[currentDept.id] : null;
  const done = state.deptIndex >= depts.length;

  const requestReport = useCallback(
    async (deptId: string, instruction?: string) => {
      const dept = depts.find((d) => d.id === deptId);
      const deptLead = DEPT_LEAD[deptId];
      if (!dept || !deptLead) return;
      if (!apiKey.trim()) {
        setShowKeyField(true);
        setState((s) => ({ ...s, error: "먼저 API 키를 입력해주세요." }));
        return;
      }
      setState((s) => ({ ...s, busy: true, error: "", showInstructionBox: false }));
      try {
        const report = await deptDailyReport(apiKey, {
          deptName: dept.name,
          leadName: deptLead.name,
          task: DEPT_BRIEF[deptId]?.task ?? dept.name,
          instruction,
        });
        setState((s) => ({ ...s, busy: false, report }));
        engine.reportToCEO(
          deptId,
          `대표님, 오늘 할 일 보고드릴게요.\n"${report.summary}" — ${report.reason}`,
          "briefing",
        );
      } catch (err) {
        setState((s) => ({ ...s, busy: false, error: err instanceof Error ? err.message : String(err) }));
      }
    },
    [apiKey, depts, engine],
  );

  const handleStart = useCallback(() => {
    setState(INITIAL_DEPT_APPROVAL_STATE);
    setHistory([]);
    void requestReport(depts[0].id);
  }, [requestReport, depts]);

  // 출근하자마자(=API 키를 입력하는 즉시) 대표 승인 없이도 바로 첫 회의가 시작되도록 자동으로 트리거한다.
  // 키를 입력하는 도중에는 발동하지 않게 살짝 debounce를 두고, 한 번 자동 시작하면 다시 발동하지 않는다.
  const autoStartedRef = useRef(false);
  useEffect(() => {
    const key = apiKey.trim();
    if (autoStartedRef.current || key.length < 10) return;
    const timer = setTimeout(() => {
      if (autoStartedRef.current) return;
      autoStartedRef.current = true;
      setShowKeyField(false);
      handleStart();
    }, 600);
    return () => clearTimeout(timer);
  }, [apiKey, handleStart]);

  const handleApprove = useCallback(() => {
    if (!currentDept || !state.report) return;
    engine.reportToCEO(currentDept.id, "승인 감사합니다! 오늘 계획대로 진행할게요.", "approved");
    setHistory((prev) => [...prev, { dept: currentDept.name, summary: state.report!.summary }]);
    const nextIndex = state.deptIndex + 1;
    setState((s) => ({ ...INITIAL_DEPT_APPROVAL_STATE, deptIndex: nextIndex, approvedCount: s.approvedCount + 1 }));
    const nextDept = depts[nextIndex];
    if (nextDept) void requestReport(nextDept.id);
  }, [currentDept, state.report, state.deptIndex, depts, requestReport, engine]);

  const handleReject = useCallback(() => {
    setState((s) => ({ ...s, showInstructionBox: true }));
  }, []);

  const handleSendInstruction = useCallback(() => {
    if (!currentDept) return;
    const instructionText = state.instruction.trim();
    engine.reportToCEO(
      currentDept.id,
      instructionText ? `네, "${instructionText}" 반영해서 다시 계획 짜볼게요.` : "네, 다시 계획 짜볼게요.",
      "instruction",
    );
    void requestReport(currentDept.id, state.instruction || undefined);
    setState((s) => ({ ...s, instruction: "" }));
  }, [currentDept, state.instruction, requestReport, engine]);

  return (
    <section className="win rail-card" style={{ margin: "24px 0" }}>
      <div className="win-bar">
        <span>🏢 all.depts.approval (12개 부서 순차 승인)</span>
        <span className="window-controls">—　▢　✕</span>
      </div>
      <div className="win-body" style={{ padding: 16 }}>
        <p style={{ fontSize: 13, opacity: 0.8, marginBottom: 12 }}>
          API 키를 입력하면 출근하자마자 바로 첫 회의가 시작돼요. 12개 부서 팀장이 순서대로 와서 오늘 할
          일을 실제 AI로 판단해서 보고하고, 승인하면 다음 팀으로 넘어가고, 미승인하면 지시를 내려서 같은
          팀장이 다시 보고받을 수 있어요. 회의·보고 내용은 몇 시에 누가 무슨 말을 했는지까지 그대로
          보고서에 남아요.
        </p>

        {showKeyField || !apiKey ? (
          <div style={{ marginBottom: 12 }}>
            <input
              type="password"
              placeholder="nvapi-... (NVIDIA API 키)"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              style={{ width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid #ccc", marginBottom: 4 }}
            />
            <p style={{ fontSize: 11, opacity: 0.7 }}>
              키는 저장되지 않고 이 탭 메모리에서만 쓰여요. build.nvidia.com에서 무료로 발급받을 수 있어요.
            </p>
          </div>
        ) : (
          <button className="text-button" style={{ marginBottom: 8 }} onClick={() => setShowKeyField(true)}>
            API 키 변경
          </button>
        )}

        {!currentDept && !done ? null : null}

        {state.deptIndex === 0 && !state.report && !state.busy && !done && apiKey.trim().length >= 10 ? (
          <button
            className="btn approve-button"
            onClick={() => {
              autoStartedRef.current = true;
              setShowKeyField(false);
              handleStart();
            }}
          >
            지금 바로 회의 시작하기
          </button>
        ) : null}

        {state.deptIndex === 0 && !state.report && !state.busy && !done && apiKey.trim().length < 10 ? (
          <p style={{ fontSize: 12, opacity: 0.7 }}>API 키를 입력하면 잠시 후 자동으로 첫 회의가 시작돼요.</p>
        ) : null}

        {state.busy ? (
          <p style={{ fontSize: 13 }}>⏳ {lead?.name ?? "팀장"}이 오늘 할 일을 정리하는 중...</p>
        ) : null}

        {done ? (
          <button
            className="btn btn-ghost"
            style={{ marginTop: 8 }}
            onClick={() => {
              autoStartedRef.current = true;
              setShowKeyField(false);
              handleStart();
            }}
          >
            🔁 오늘 회의 다시 시작하기
          </button>
        ) : null}

        {state.error ? (
          <p style={{ color: "#c0392b", fontSize: 12, marginTop: 8, whiteSpace: "pre-wrap" }}>{state.error}</p>
        ) : null}

        {currentDept && state.report && !state.busy ? (
          <div className="report-card" style={{ marginTop: 12, padding: 12, background: "rgba(0,0,0,0.03)", borderRadius: 8 }}>
            <p style={{ fontWeight: 600, marginBottom: 4 }}>
              📋 {currentDept.name} {lead?.name} 팀장 보고
              <span className="mini-badge mint" style={{ marginLeft: 8, fontSize: 11 }}>
                {state.deptIndex + 1} / {depts.length}
              </span>
            </p>
            <p style={{ fontSize: 13, marginBottom: 8, opacity: 0.85 }}>{state.report.reason}</p>
            <div style={{ fontSize: 13, lineHeight: 1.6 }}>
              <div><b>오늘 할 일</b>: {state.report.summary}</div>
              <div style={{ marginTop: 4 }}><b>실행 계획</b>:</div>
              <ul style={{ margin: "4px 0 0 18px" }}>
                {state.report.steps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button className="btn approve-button" onClick={handleApprove}>
                ✅ 승인
              </button>
              <button className="btn btn-ghost" onClick={handleReject}>
                ❌ 미승인
              </button>
            </div>
            {state.showInstructionBox ? (
              <div style={{ marginTop: 10 }}>
                <textarea
                  placeholder="예: 이 부분은 이렇게 바꿔서 다시 계획해주세요"
                  value={state.instruction}
                  onChange={(e) => setState((s) => ({ ...s, instruction: e.target.value }))}
                  style={{ width: "100%", minHeight: 60, padding: 8, borderRadius: 6, border: "1px solid #ccc", fontSize: 13 }}
                />
                <button className="btn approve-button" style={{ marginTop: 6 }} onClick={handleSendInstruction}>
                  지시 전달하고 다시 보고받기
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        {done ? (
          <p style={{ fontSize: 14, fontWeight: 600, marginTop: 12 }}>
            🎉 오늘 12개 부서 보고를 전부 승인했어요! 수고하셨어요.
          </p>
        ) : null}

        {history.length > 0 ? (
          <div style={{ marginTop: 16, borderTop: "1px solid rgba(0,0,0,0.1)", paddingTop: 10 }}>
            <p style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>✅ 오늘 승인된 부서 ({history.length}/{depts.length})</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {history.map((h, i) => (
                <div key={i} style={{ fontSize: 12, opacity: 0.85 }}>
                  · {h.dept}: {h.summary}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

/**
 * LIVE 화면(회의실 장면) 안에서 쓰는 아침 회의 승인 패널.
 * sim.ts의 aiMorningMeeting()이 회의실에 팀장들을 앉히고 발언 차례(morningSpeakerDeptId)를
 * 넘겨주면, 이 컴포넌트가 실제 AI(deptDailyReport)를 호출해서 보고 내용을 만들고
 * reportMorningSpeech()로 그 결과를 씬에 주입한다.
 * 대표가 승인하면 advanceMorningMeeting()으로 다음 팀장에게 넘어가고,
 * 반려하면 지시사항을 담아 같은 팀장에게 다시 AI를 호출한다.
 */
type MorningPanelState = {
  report: DeptDailyReport | null;
  busy: boolean;
  error: string;
  showInstructionBox: boolean;
  instruction: string;
  /** 이 부서 차례에서 이미 보고를 만들어 씬에 주입했는지 (중복 호출 방지) */
  requestedForDept: string | null;
};

const INITIAL_MORNING_PANEL_STATE: MorningPanelState = {
  report: null,
  busy: false,
  error: "",
  showInstructionBox: false,
  instruction: "",
  requestedForDept: null,
};

function AiMorningMeetingPanel({ engine, snap }: { engine: Company; snap: Snapshot }) {
  const [apiKey, setApiKey] = useState("");
  const [showKeyField, setShowKeyField] = useState(true);
  const [state, setState] = useState<MorningPanelState>(INITIAL_MORNING_PANEL_STATE);
  const [approvedCount, setApprovedCount] = useState(0);
  const [history, setHistory] = useState<{ dept: string; summary: string }[]>([]);

  const speakerDeptId = snap.morningSpeakerDeptId;
  const dept = speakerDeptId ? DEPT_ROOMS.find((d) => d.id === speakerDeptId) ?? null : null;
  const lead = speakerDeptId ? DEPT_LEAD[speakerDeptId] : null;

  const requestReport = useCallback(
    async (deptId: string, instruction?: string) => {
      const targetDept = DEPT_ROOMS.find((d) => d.id === deptId);
      const deptLead = DEPT_LEAD[deptId];
      if (!targetDept || !deptLead) return;

      setState((s) => ({ ...s, busy: true, error: "", showInstructionBox: false, requestedForDept: deptId }));

      // API 키가 없으면 실제 AI 대신 부서별로 미리 준비된 기본 보고를 대신 넣는다.
      // 키가 없다고 회의가 영원히 멈춰버리면(=하루 전체가 07:10에서 정지) 안 되므로,
      // 항상 하루가 끝까지 진행되도록 보장한다. 키를 넣으면 그때부터는 실제 AI 보고로 진행된다.
      if (!apiKey.trim()) {
        const brief = DEPT_BRIEF[deptId];
        const report: DeptDailyReport = {
          summary: brief?.report ?? `${targetDept.name} 오늘 할 일을 진행합니다.`,
          steps: [brief?.task, brief?.tomorrow, brief?.improve].filter((s): s is string => Boolean(s)),
          reason: instruction
            ? `지시사항("${instruction}") 반영해서 기본 계획으로 다시 보고할게요. (API 키 미입력 — 기본 보고)`
            : "AI 키가 없어 기본 계획으로 보고할게요. 키를 입력하면 그때부터 실시간 AI 보고로 바뀌어요.",
        };
        window.setTimeout(
          () => {
            setState((s) => ({ ...s, busy: false, report }));
            engine.reportMorningSpeech(deptId, `"${report.summary}" — ${report.reason}`);
          },
          500 + Math.random() * 500,
        );
        return;
      }

      try {
        const report = await deptDailyReport(apiKey, {
          deptName: targetDept.name,
          leadName: deptLead.name,
          task: DEPT_BRIEF[deptId]?.task ?? targetDept.name,
          instruction,
        });
        setState((s) => ({ ...s, busy: false, report }));
        // AI가 만든 보고 내용을 회의실 씬에 주입 — 캐릭터가 이 텍스트를 말풍선으로 말한다
        engine.reportMorningSpeech(deptId, `"${report.summary}" — ${report.reason}`);
      } catch (err) {
        // AI 호출이 실패해도 회의가 영원히 멈추지 않도록, 잠시 후 기본 보고로 자동 대체한다.
        const brief = DEPT_BRIEF[deptId];
        const fallback: DeptDailyReport = {
          summary: brief?.report ?? `${targetDept.name} 오늘 할 일을 진행합니다.`,
          steps: [brief?.task, brief?.tomorrow, brief?.improve].filter((s): s is string => Boolean(s)),
          reason: "AI 호출에 실패해서 기본 계획으로 대신 보고할게요.",
        };
        const message = err instanceof Error ? err.message : String(err);
        setState((s) => ({ ...s, busy: false, error: `${message} — 잠시 후 기본 보고로 진행합니다.`, report: fallback }));
        window.setTimeout(() => {
          engine.reportMorningSpeech(deptId, `"${fallback.summary}" — ${fallback.reason}`);
        }, 1200);
      }
    },
    [apiKey, engine],
  );

  // 회의실에서 새 팀장 차례(morningSpeakerDeptId)가 되면 자동으로 AI 보고를 요청한다.
  // API 키 유무와 무관하게 항상 요청한다 — 키가 없으면 requestReport 내부에서 기본 보고로 대체된다.
  useEffect(() => {
    if (!speakerDeptId) return;
    if (state.requestedForDept === speakerDeptId) return;
    setState({ ...INITIAL_MORNING_PANEL_STATE, requestedForDept: speakerDeptId });
    void requestReport(speakerDeptId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speakerDeptId, apiKey]);

  const handleApprove = useCallback(() => {
    if (!dept || !state.report) return;
    setHistory((prev) => [...prev, { dept: dept.name, summary: state.report!.summary }]);
    setApprovedCount((n) => n + 1);
    engine.pushReportLog(dept.id, "대표", "승인. 계획대로 진행해주세요.", "approved");
    setState(INITIAL_MORNING_PANEL_STATE);
    engine.advanceMorningMeeting();
  }, [dept, state.report, engine]);

  const handleReject = useCallback(() => {
    setState((s) => ({ ...s, showInstructionBox: true }));
  }, []);

  const handleSendInstruction = useCallback(() => {
    if (!speakerDeptId) return;
    const instructionText = state.instruction.trim();
    engine.pushReportLog(
      speakerDeptId,
      "대표",
      instructionText ? `반려: "${instructionText}" 반영해서 다시 보고해주세요.` : "반려. 다시 계획을 짜서 보고해주세요.",
      "rejected",
    );
    void requestReport(speakerDeptId, state.instruction || undefined);
    setState((s) => ({ ...s, instruction: "", showInstructionBox: false }));
  }, [speakerDeptId, state.instruction, requestReport, engine]);

  if (!snap.meetingTitle || !snap.meetingTitle.includes("아침 회의")) {
    // 회의 중이 아니면 지금까지의 승인 이력만 짧게 보여주고 접는다
    if (approvedCount === 0) return null;
    return (
      <section className="win rail-card" id="ceo-approval">
        <div className="win-bar">
          <span>✅ ceo.approval</span>
          <span className="window-controls">—　▢　✕</span>
        </div>
        <div className="win-body approval-body">
          <p style={{ fontSize: 13, opacity: 0.8 }}>
            오늘 아침 회의에서 {approvedCount}개 팀 보고를 승인했어요.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="win rail-card" id="ceo-approval">
      <div className="win-bar">
        <span>✅ ceo.approval · 아침 회의</span>
        <span className="window-controls">—　▢　✕</span>
      </div>
      <div className={`win-body approval-body ${state.report ? "pending" : ""}`}>
        {showKeyField || !apiKey ? (
          <div style={{ marginBottom: 12 }}>
            <input
              type="password"
              placeholder="nvapi-... (NVIDIA API 키)"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              style={{ width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid #ccc", marginBottom: 4 }}
            />
            <p style={{ fontSize: 11, opacity: 0.7 }}>
              키를 입력하면 팀장들이 회의실에서 실제 AI로 오늘 할 일을 보고해요. 키가 없어도 기본 계획으로 회의는
              계속 진행돼요. 어디에도 저장되지 않아요.
            </p>
          </div>
        ) : (
          <button className="text-button" style={{ marginBottom: 8 }} onClick={() => setShowKeyField(true)}>
            API 키 변경
          </button>
        )}

        {!apiKey.trim() ? (
          <p style={{ fontSize: 13, opacity: 0.75 }}>
            💡 API 키가 없어서 팀장들이 기본 계획으로 보고하고 있어요. 실시간 AI 보고를 보고 싶으면 위에 키를
            입력하세요.
          </p>
        ) : null}

        {state.busy ? (
          <p style={{ fontSize: 13 }}>⏳ {lead?.name ?? "팀장"}이 오늘 할 일을 정리하는 중...</p>
        ) : null}

        {state.error ? (
          <p style={{ color: "#c0392b", fontSize: 12, marginTop: 8, whiteSpace: "pre-wrap" }}>{state.error}</p>
        ) : null}

        {dept && state.report && !state.busy ? (
          <div className="report-card" style={{ marginTop: 4, padding: 12, background: "rgba(0,0,0,0.03)", borderRadius: 8 }}>
            <p style={{ fontWeight: 600, marginBottom: 4 }}>
              📋 {dept.name} {lead?.name} 팀장 보고
              <span className="mini-badge mint" style={{ marginLeft: 8, fontSize: 11 }}>
                {approvedCount + 1} / {DEPT_ROOMS.length}
              </span>
            </p>
            <p style={{ fontSize: 13, marginBottom: 8, opacity: 0.85 }}>{state.report.reason}</p>
            <div style={{ fontSize: 13, lineHeight: 1.6 }}>
              <div><b>오늘 할 일</b>: {state.report.summary}</div>
              <div style={{ marginTop: 4 }}><b>실행 계획</b>:</div>
              <ul style={{ margin: "4px 0 0 18px" }}>
                {state.report.steps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button className="btn approve-button" onClick={handleApprove}>
                ✅ 승인
              </button>
              <button className="btn btn-ghost" onClick={handleReject}>
                ❌ 반려
              </button>
            </div>
            {state.showInstructionBox ? (
              <div style={{ marginTop: 10 }}>
                <textarea
                  placeholder="예: 이 부분은 이렇게 바꿔서 다시 계획해주세요"
                  value={state.instruction}
                  onChange={(e) => setState((s) => ({ ...s, instruction: e.target.value }))}
                  style={{ width: "100%", minHeight: 60, padding: 8, borderRadius: 6, border: "1px solid #ccc", fontSize: 13 }}
                />
                <button className="btn approve-button" style={{ marginTop: 6 }} onClick={handleSendInstruction}>
                  지시 전달하고 다시 보고받기
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        {history.length > 0 ? (
          <div style={{ marginTop: 16, borderTop: "1px solid rgba(0,0,0,0.1)", paddingTop: 10 }}>
            <p style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
              ✅ 오늘 승인된 부서 ({history.length}/{DEPT_ROOMS.length})
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {history.map((h, i) => (
                <div key={i} style={{ fontSize: 12, opacity: 0.85 }}>
                  · {h.dept}: {h.summary}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function AutonomousTeamPipeline({ engine }: { engine: Company }) {
  const [apiKey, setApiKey] = useState("");
  const [showKeyField, setShowKeyField] = useState(true);
  const [state, setState] = useState<PipelineState>(INITIAL_PIPELINE_STATE);
  const [publishedTitles, setPublishedTitles] = useState<string[]>([]);
  const [finalDrafts, setFinalDrafts] = useState<{ title: string; markdown: string }[]>([]);
  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>(() => getAuditEntries());

  useEffect(() => {
    const unsubscribe = subscribeAudit(() => setAuditLog(getAuditEntries()));
    return unsubscribe;
  }, []);

  const runAudit = useCallback(
    (stage: "기획" | "작성" | "검수", targetTitle: string, content: string) => {
      if (!apiKey.trim()) return; // 감사도 같은 키를 쓰지만, 없으면 조용히 건너뜀
      void auditStage(apiKey, {
        leadName: DEPT_LEAD["partner"]?.name ?? "감사 팀장",
        stage,
        content,
        rules: [...AUDIT_RULES[stage]],
      })
        .then((verdict) => {
          const entry: AuditLogEntry = {
            ...verdict,
            id: nextAuditId(),
            timestamp: new Date().toISOString(),
            stage,
            targetTitle,
          };
          addAuditEntry(entry);
        })
        .catch(() => {
          // 감사 실패는 본 업무를 막지 않는다 — 다음 감사 때 다시 시도됨
        });
    },
    [apiKey],
  );

  const requestPlan = useCallback(
    async (instruction?: string) => {
      if (!apiKey.trim()) {
        setShowKeyField(true);
        setState((s) => ({ ...s, error: "먼저 API 키를 입력해주세요." }));
        return;
      }
      setState((s) => ({ ...s, busy: true, error: "", showInstructionBox: false }));
      try {
        const proposal = await planContent(apiKey, {
          deptName: DEPT_LEAD["strategy1"]?.role ?? "키워드 기획팀",
          leadName: DEPT_LEAD["strategy1"]?.name ?? "기획 팀장",
          recentTitles: [...publishedTitles, ...finalDrafts.map((d) => d.title)],
          instruction,
        });
        setState((s) => ({ ...s, busy: false, proposal, stage: "briefing" }));
        engine.reportToCEO(
          "strategy1",
          `대표님, 오늘 기획안 보고드릴게요.\n"${proposal.title}" — ${proposal.reason}`,
          "briefing",
        );
        runAudit(
          "기획",
          proposal.title,
          `카테고리: ${proposal.category}\n제목: ${proposal.title}\n키워드: ${proposal.keyword}\n기획의도: ${proposal.angle}\n실행계획: ${proposal.steps.join(" / ")}`,
        );
      } catch (err) {
        setState((s) => ({ ...s, busy: false, error: err instanceof Error ? err.message : String(err) }));
      }
    },
    [apiKey, publishedTitles, finalDrafts, runAudit],
  );

  const requestReview = useCallback(
    async (markdown: string, keyword: string, category: string, title: string) => {
      setState((s) => ({ ...s, busy: true, error: "" }));
      try {
        const review = await reviewDraft(apiKey, markdown, {
          leadName: DEPT_LEAD["qa"]?.name ?? "검수 팀장",
          keyword,
          category,
        });
        setState((s) => ({ ...s, busy: false, review }));
        engine.reportToCEO(
          "qa",
          `대표님, "${title}" 검수 결과예요.\n${review.passed ? "✅ 통과했어요." : "❌ 반려했어요."} ${review.feedback}`,
          review.passed ? "approved" : "rejected",
        );
        runAudit(
          "검수",
          title,
          `판정: ${review.passed ? "통과" : "반려"}\n피드백: ${review.feedback}\n\n[검수 대상 원고 일부]\n${markdown.slice(0, 1500)}`,
        );
      } catch (err) {
        setState((s) => ({ ...s, busy: false, error: err instanceof Error ? err.message : String(err) }));
      }
    },
    [apiKey, runAudit],
  );

  const requestWrite = useCallback(
    async (feedback?: string) => {
      if (!state.proposal) return;
      setState((s) => ({ ...s, busy: true, error: "", stage: "working" }));
      try {
        const draft = await writeDraft(apiKey, state.proposal, {
          leadName: DEPT_LEAD["strategy2"]?.name ?? "원고 팀장",
          feedback,
        });
        setState((s) => ({ ...s, busy: false, draft, stage: "reviewing" }));
        runAudit("작성", state.proposal.title, draft);
        // 작성이 끝나면 곧바로 검수 AI를 호출
        void requestReview(draft, state.proposal.keyword, state.proposal.category, state.proposal.title);
      } catch (err) {
        setState((s) => ({ ...s, busy: false, error: err instanceof Error ? err.message : String(err) }));
      }
    },
    [apiKey, state.proposal, requestReview, runAudit],
  );

  const handleApprove = useCallback(() => {
    if (state.stage === "briefing" && state.proposal) {
      engine.reportToCEO("strategy1", "승인 감사합니다! 바로 원고팀에 넘길게요.", "approved");
      void requestWrite(undefined);
    }
  }, [state.stage, state.proposal, requestWrite, engine]);

  const handleReviewOutcome = useCallback(() => {
    if (!state.review) return;
    if (state.review.passed && state.draft && state.proposal) {
      engine.reportToCEO("strategy2", "원고 확정했습니다! 오늘 몫은 여기까지예요.", "approved");
      setFinalDrafts((prev) => [...prev, { title: state.proposal!.title, markdown: state.draft! }]);
      setPublishedTitles((prev) => [...prev, state.proposal!.title]);
      setState(INITIAL_PIPELINE_STATE);
    } else if (state.retryCount < 2) {
      // 반려 → 원고팀이 피드백 받아서 재작성
      const feedback = state.review.feedback;
      engine.reportToCEO("strategy2", "반려 사유 확인했어요. 바로 다시 써서 올게요.", "instruction");
      setState((s) => ({ ...s, retryCount: s.retryCount + 1, review: null, draft: null }));
      void requestWrite(feedback);
    } else {
      setState((s) => ({ ...s, error: "재작성 2회 시도 후에도 통과하지 못했어요. 기획을 바꿔서 다시 시작해주세요." }));
    }
  }, [state.review, state.draft, state.proposal, state.retryCount, requestWrite, engine]);

  const handleReject = useCallback(() => {
    setState((s) => ({ ...s, showInstructionBox: true }));
  }, []);

  const handleSendInstruction = useCallback(() => {
    const instructionText = state.instruction.trim();
    engine.reportToCEO(
      "strategy1",
      instructionText ? `네, "${instructionText}" 반영해서 다시 기획해올게요.` : "네, 다른 방향으로 다시 기획해올게요.",
      "instruction",
    );
    void requestPlan(state.instruction || undefined);
    setState((s) => ({ ...s, instruction: "" }));
  }, [requestPlan, state.instruction, engine]);

  const handleStart = useCallback(() => {
    setState(INITIAL_PIPELINE_STATE);
    void requestPlan();
  }, [requestPlan]);

  const planLeadName = DEPT_LEAD["strategy1"]?.name ?? "기획 팀장";
  const planDeptTitle = "키워드 기획팀";

  return (
    <section className="win rail-card" style={{ margin: "24px 0" }}>
      <div className="win-bar">
        <span>🏢 real.company (실시간 팀장 보고)</span>
        <span className="window-controls">—　▢　✕</span>
      </div>
      <div className="win-body" style={{ padding: 16 }}>
        <p style={{ fontSize: 13, opacity: 0.8, marginBottom: 12 }}>
          팀장 AI가 실시간으로 와서 오늘 할 일을 보고해요. 승인하면 그대로 진행되고,
          미승인하면 지시를 내려서 다시 보고받을 수 있어요.
        </p>

        {showKeyField || !apiKey ? (
          <div style={{ marginBottom: 12 }}>
            <input
              type="password"
              placeholder="nvapi-... (NVIDIA API 키)"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              style={{ width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid #ccc", marginBottom: 4 }}
            />
            <p style={{ fontSize: 11, opacity: 0.7 }}>
              키는 저장되지 않고 이 탭 메모리에서만 쓰여요. build.nvidia.com에서 무료로 발급받을 수 있어요.
            </p>
          </div>
        ) : (
          <button className="text-button" style={{ marginBottom: 8 }} onClick={() => setShowKeyField(true)}>
            API 키 변경
          </button>
        )}

        {state.stage === "briefing" && !state.proposal && !state.busy ? (
          <button className="btn approve-button" onClick={handleStart}>
            오늘 업무 시작하기
          </button>
        ) : null}

        {state.busy ? <p style={{ fontSize: 13 }}>⏳ {leadNameForStage(state)} 작업 중...</p> : null}

        {state.error ? (
          <p style={{ color: "#c0392b", fontSize: 12, marginTop: 8, whiteSpace: "pre-wrap" }}>{state.error}</p>
        ) : null}

        {/* 1) 기획 보고 */}
        {state.proposal && state.stage === "briefing" && !state.busy ? (
          <div className="report-card" style={{ marginTop: 12, padding: 12, background: "rgba(0,0,0,0.03)", borderRadius: 8 }}>
            <p style={{ fontWeight: 600, marginBottom: 4 }}>
              📋 {planDeptTitle} {planLeadName} 팀장 보고
              <span className="mini-badge mint" style={{ marginLeft: 8, fontSize: 11 }}>
                {state.proposal.category}
              </span>
            </p>
            <p style={{ fontSize: 13, marginBottom: 8, opacity: 0.85 }}>{state.proposal.reason}</p>
            <div style={{ fontSize: 13, lineHeight: 1.6 }}>
              <div><b>제목</b>: {state.proposal.title}</div>
              <div><b>키워드</b>: {state.proposal.keyword}</div>
              <div><b>기획 의도</b>: {state.proposal.angle}</div>
              <div style={{ marginTop: 4 }}><b>실행 계획</b>:</div>
              <ul style={{ margin: "4px 0 0 18px" }}>
                {state.proposal.steps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button className="btn approve-button" onClick={handleApprove}>
                ✅ 승인
              </button>
              <button className="btn btn-ghost" onClick={handleReject}>
                ❌ 미승인
              </button>
            </div>
            {state.showInstructionBox ? (
              <div style={{ marginTop: 10 }}>
                <textarea
                  placeholder="예: 이 주제 말고 다른 부위로, 더 캐주얼한 톤으로 등"
                  value={state.instruction}
                  onChange={(e) => setState((s) => ({ ...s, instruction: e.target.value }))}
                  style={{ width: "100%", minHeight: 60, padding: 8, borderRadius: 6, border: "1px solid #ccc", fontSize: 13 }}
                />
                <button className="btn approve-button" style={{ marginTop: 6 }} onClick={handleSendInstruction}>
                  지시 전달하고 다시 보고받기
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* 2) 작성 중 */}
        {state.stage === "working" && state.busy ? (
          <p style={{ fontSize: 13, marginTop: 8 }}>
            ✍️ {DEPT_LEAD["strategy2"]?.name ?? "원고 팀장"}이 원고를 쓰고 있어요...
          </p>
        ) : null}

        {/* 3) 검수 결과 */}
        {state.stage === "reviewing" && state.review && !state.busy ? (
          <div className="report-card" style={{ marginTop: 12, padding: 12, background: "rgba(0,0,0,0.03)", borderRadius: 8 }}>
            <p style={{ fontWeight: 600, marginBottom: 4 }}>
              🔍 {DEPT_LEAD["qa"]?.name ?? "검수 팀장"} 검수 결과: {state.review.passed ? "✅ 통과" : "❌ 반려"}
            </p>
            <p style={{ fontSize: 13, opacity: 0.85 }}>{state.review.feedback}</p>
            {!state.review.passed && state.retryCount >= 2 ? null : (
              <button className="btn approve-button" style={{ marginTop: 8 }} onClick={handleReviewOutcome}>
                {state.review.passed ? "원고 확정하고 다음 팀으로" : "피드백 반영해서 재작성 요청"}
              </button>
            )}
          </div>
        ) : null}

        {/* 완료된 원고 목록 */}
        {finalDrafts.length > 0 ? (
          <div style={{ marginTop: 16, borderTop: "1px solid rgba(0,0,0,0.1)", paddingTop: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <p style={{ fontSize: 12, fontWeight: 600 }}>✅ 오늘 확정된 원고</p>
              {finalDrafts.length > 1 ? (
                <button
                  className="text-button"
                  onClick={() => {
                    finalDrafts.forEach((d, i) => {
                      window.setTimeout(() => {
                        const dateStr = new Date().toISOString().slice(0, 10);
                        downloadMarkdownFile(`${dateStr}-${d.title.slice(0, 20)}.md`, d.markdown);
                      }, i * 300); // 브라우저가 다운로드를 한꺼번에 막지 않도록 살짝 간격을 둠
                    });
                  }}
                >
                  📥 전체 다운로드
                </button>
              ) : null}
            </div>
            {finalDrafts.map((d, i) => (
              <details key={i} style={{ marginBottom: 6 }}>
                <summary style={{ fontSize: 13, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>{d.title}</span>
                  <button
                    className="text-button"
                    style={{ fontSize: 11 }}
                    onClick={(e) => {
                      e.preventDefault();
                      const dateStr = new Date().toISOString().slice(0, 10);
                      downloadMarkdownFile(`${dateStr}-${d.title.slice(0, 20)}.md`, d.markdown);
                    }}
                  >
                    📥 다운로드
                  </button>
                </summary>
                <pre
                  style={{
                    maxHeight: 220,
                    overflow: "auto",
                    whiteSpace: "pre-wrap",
                    fontSize: 12,
                    background: "rgba(0,0,0,0.04)",
                    padding: 8,
                    borderRadius: 6,
                  }}
                >
                  {d.markdown}
                </pre>
              </details>
            ))}
          </div>
        ) : null}

        <AuditLogPanel entries={auditLog} />
      </div>
    </section>
  );
}

/** 감사팀(정파랑 팀장)이 기획·작성·검수 단계마다 실시간으로 남긴 통과/반려 기록 */
function AuditLogPanel({ entries }: { entries: AuditLogEntry[] }) {
  const leadName = DEPT_LEAD["partner"]?.name ?? "감사 팀장";
  const sorted = [...entries].sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  const passCount = entries.filter((e) => e.passed).length;
  const failCount = entries.length - passCount;

  return (
    <div style={{ marginTop: 16, borderTop: "1px solid rgba(0,0,0,0.1)", paddingTop: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <p style={{ fontSize: 12, fontWeight: 600 }}>
          🕵️ 감사팀 ({leadName}) 실시간 로그
        </p>
        {entries.length > 0 ? (
          <span style={{ fontSize: 11, opacity: 0.7 }}>
            통과 {passCount} · 반려 {failCount}
          </span>
        ) : null}
      </div>

      {sorted.length === 0 ? (
        <p style={{ fontSize: 12, opacity: 0.6 }}>
          아직 감사 기록이 없어요. 기획·작성·검수가 진행되면 감사팀이 단계마다 자동으로 확인해서 여기 남겨요.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 260, overflow: "auto" }}>
          {sorted.map((entry) => (
            <div
              key={entry.id}
              style={{
                padding: "8px 10px",
                borderRadius: 8,
                background: entry.passed ? "rgba(184,240,221,0.25)" : "rgba(255,143,192,0.15)",
                fontSize: 12,
                lineHeight: 1.5,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <b>
                  {entry.passed ? "✅" : "❌"} [{entry.stage}] {entry.targetTitle}
                </b>
                <span style={{ opacity: 0.6, whiteSpace: "nowrap" }}>
                  {new Date(entry.timestamp).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
              <p style={{ marginTop: 2, opacity: 0.85 }}>{entry.feedback}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function leadNameForStage(state: PipelineState): string {
  if (state.stage === "briefing") return DEPT_LEAD["strategy1"]?.name ?? "기획 팀장";
  if (state.stage === "working") return DEPT_LEAD["strategy2"]?.name ?? "원고 팀장";
  return DEPT_LEAD["qa"]?.name ?? "검수 팀장";
}

function AiWriterPanel({ plan }: { plan: import("./game/sim").ContentPlan }) {
  const [apiKey, setApiKey] = useState("");
  const [showKeyField, setShowKeyField] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<WriterResult | null>(null);

  const handleGenerate = useCallback(async () => {
    if (!apiKey.trim()) {
      setShowKeyField(true);
      setError("먼저 API 키를 입력해주세요.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const draft = await generateRecipeDraft(apiKey, {
        title: plan.title,
        keyword: plan.keyword,
        angle: plan.angle,
        steps: plan.steps,
      });
      setResult(draft);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [apiKey, plan]);

  const handleDownload = useCallback(() => {
    if (!result) return;
    const dateStr = new Date().toISOString().slice(0, 10);
    downloadMarkdownFile(`원고_${plan.title.slice(0, 20)}_${dateStr}.md`, result.markdown);
  }, [result, plan.title]);

  return (
    <section className="win rail-card">
      <div className="win-bar">
        <span>✍️ ai.writer (실제 생성)</span>
        <span className="window-controls">—　▢　✕</span>
      </div>
      <div className="win-body approval-body">
        <p style={{ marginBottom: 8 }}>
          이 승인된 기획안으로 <b>실제 NVIDIA NIM(무료 티어)</b>을 호출해서 진짜 원고를 만들어요.
          화면 연출이 아니라 진짜 텍스트가 생성됩니다.
        </p>

        {showKeyField || !apiKey ? (
          <div style={{ marginBottom: 8 }}>
            <input
              type="password"
              placeholder="nvapi-... (NVIDIA API 키)"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              style={{
                width: "100%",
                padding: "6px 8px",
                borderRadius: 6,
                border: "1px solid #ccc",
                marginBottom: 4,
              }}
            />
            <p style={{ fontSize: 11, opacity: 0.7 }}>
              키는 저장되지 않고 이 탭 메모리에서만 쓰여요. 새로고침하면 사라져요.
              build.nvidia.com에서 무료로 발급받을 수 있어요.
            </p>
          </div>
        ) : (
          <button
            className="text-button"
            style={{ marginBottom: 8 }}
            onClick={() => setShowKeyField(true)}
          >
            API 키 변경
          </button>
        )}

        <button className="btn approve-button" onClick={handleGenerate} disabled={busy}>
          {busy ? "원고 생성 중..." : "실제 원고 생성하기"}
        </button>

        {error ? (
          <p style={{ color: "#c0392b", fontSize: 12, marginTop: 8, whiteSpace: "pre-wrap" }}>{error}</p>
        ) : null}

        {result ? (
          <div style={{ marginTop: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <span className="mini-badge mint">생성 완료 · {result.model}</span>
              <button className="text-button" onClick={handleDownload}>
                📥 .md 다운로드
              </button>
            </div>
            <pre
              style={{
                maxHeight: 260,
                overflow: "auto",
                whiteSpace: "pre-wrap",
                fontSize: 12,
                background: "rgba(0,0,0,0.04)",
                padding: 10,
                borderRadius: 8,
              }}
            >
              {result.markdown}
            </pre>
          </div>
        ) : null}

        <div style={{ marginTop: 16, borderTop: "1px solid rgba(0,0,0,0.1)", paddingTop: 12 }}>
          <p style={{ fontSize: 12, marginBottom: 6 }}>
            <b>또는</b> — 매일 자동으로 쌓이게 하고 싶다면, GitHub Actions로 실제 발행 파이프라인을
            돌릴 수 있어요. "📰 실제 발행된 원고" 탭에 결과가 쌓여요.
          </p>
          {GITHUB_REPO ? (
            <a
              className="btn btn-ghost"
              href={`https://github.com/${GITHUB_REPO}/actions/workflows/generate-content.yml`}
              target="_blank"
              rel="noreferrer"
              style={{ display: "inline-block", fontSize: 12 }}
            >
              GitHub Actions에서 실제 생성 실행하기 →
            </a>
          ) : (
            <p style={{ fontSize: 11, opacity: 0.7 }}>
              company.config.ts의 GITHUB_REPO를 채우면 여기 바로가기 버튼이 생겨요.
            </p>
          )}
          <p style={{ fontSize: 11, opacity: 0.6, marginTop: 6 }}>
            실행 화면에서 아래 값을 넣으면 이 승인안 그대로 생성돼요 (복사해서 붙여넣기):
          </p>
          <pre
            style={{
              fontSize: 11,
              background: "rgba(0,0,0,0.04)",
              padding: 8,
              borderRadius: 6,
              whiteSpace: "pre-wrap",
            }}
          >
            {`title: ${plan.title}\nkeyword: ${plan.keyword}\nangle: ${plan.angle}\nsteps:\n${plan.steps.join("\n")}`}
          </pre>
        </div>
      </div>
    </section>
  );
}

type ArticleEntry = {
  file: string;
  title: string;
  keyword: string;
  date: string;
  generatedAt: string;
};

/**
 * GitHub Actions가 실제로 생성해서 쌓은 원고 목록을 보여주는 화면.
 * public/content/index.json 을 읽어온다 (생성 스크립트가 매번 갱신함).
 */
function ArticlesView() {
  const [articles, setArticles] = useState<ArticleEntry[] | null>(null);
  const [error, setError] = useState("");
  const [openFile, setOpenFile] = useState<string | null>(null);
  const [openText, setOpenText] = useState("");
  const [openBusy, setOpenBusy] = useState(false);

  useEffect(() => {
    fetch(new URL("content/index.json", document.baseURI).toString())
      .then((res) => {
        if (!res.ok) throw new Error("목록을 불러오지 못했어요.");
        return res.json();
      })
      .then((data: ArticleEntry[]) => setArticles(data))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  const openArticle = useCallback(async (file: string) => {
    setOpenFile(file);
    setOpenBusy(true);
    setOpenText("");
    try {
      const res = await fetch(new URL(`content/${file}`, document.baseURI).toString());
      if (!res.ok) throw new Error("원고를 불러오지 못했어요.");
      setOpenText(await res.text());
    } catch (err) {
      setOpenText(err instanceof Error ? err.message : String(err));
    } finally {
      setOpenBusy(false);
    }
  }, []);

  return (
    <section className="win rail-card" style={{ margin: "24px 0" }}>
      <div className="win-bar">
        <span>📰 real.content</span>
        <span className="window-controls">—　▢　✕</span>
      </div>
      <div className="win-body" style={{ padding: 16 }}>
        <p style={{ marginBottom: 12, fontSize: 13, opacity: 0.8 }}>
          여기 보이는 글은 화면 연출이 아니라, GitHub Actions가 실제로 NVIDIA NIM을 호출해서 만든
          진짜 원고예요. 매일 자동으로 쌓이거나, 저장소 Actions 탭에서 직접 실행할 수 있어요.
        </p>

        {error ? <p style={{ color: "#c0392b" }}>{error}</p> : null}

        {articles === null && !error ? <p>목록을 불러오는 중...</p> : null}

        {articles && articles.length === 0 ? (
          <p style={{ opacity: 0.7 }}>
            아직 실제로 생성된 원고가 없어요. GitHub 저장소 Actions 탭에서 "AI 원고 생성"
            워크플로를 실행하면 여기에 쌓이기 시작해요.
          </p>
        ) : null}

        {articles && articles.length > 0 ? (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {articles.map((a) => (
              <li
                key={a.file}
                style={{
                  padding: "10px 0",
                  borderBottom: "1px solid rgba(0,0,0,0.08)",
                  cursor: "pointer",
                }}
                onClick={() => openArticle(a.file)}
              >
                <b>{a.title}</b>
                <div style={{ fontSize: 12, opacity: 0.6 }}>
                  {a.date} · 키워드: {a.keyword}
                </div>
              </li>
            ))}
          </ul>
        ) : null}

        {openFile ? (
          <div style={{ marginTop: 16, borderTop: "1px solid rgba(0,0,0,0.1)", paddingTop: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <b style={{ fontSize: 13 }}>{openFile}</b>
              <button className="text-button" onClick={() => setOpenFile(null)}>
                닫기
              </button>
            </div>
            {openBusy ? (
              <p>불러오는 중...</p>
            ) : (
              <pre
                style={{
                  maxHeight: 320,
                  overflow: "auto",
                  whiteSpace: "pre-wrap",
                  fontSize: 12,
                  background: "rgba(0,0,0,0.04)",
                  padding: 10,
                  borderRadius: 8,
                }}
              >
                {openText}
              </pre>
            )}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function LiveView({
  engine,
  snap,
  follow,
  setFollow,
  selectedId,
  onSelect,
  onStart,
  onApprove,
  onDuty,
  onPublish,
  onDownload,
  publishBusy,
  publishResult,
  autoLoop,
  onToggleAutoLoop,
  dayCount,
}: {
  engine: Company;
  snap: Snapshot;
  follow: boolean;
  setFollow: (value: boolean) => void;
  selectedId: string | null;
  onSelect: (agent: Agent) => void;
  onStart: () => void;
  onApprove: () => void;
  onDuty: number;
  onPublish: () => void;
  onDownload: () => void;
  publishBusy: boolean;
  publishResult: PublishResult | null;
  autoLoop: boolean;
  onToggleAutoLoop: () => void;
  dayCount: number;
}) {
  const progress = Math.round((snap.phaseIndex / (PHASES.length - 1)) * 100);

  return (
    <>
      <header className="live-hero">
        <div>
          <p className="eyebrow">LIVE OFFICE · 32 AI STAFF · REAL-TIME</p>
          <h1>
            {COMPANY.titlePrefix} <em className="highlight">{COMPANY.titleAccent}</em>
          </h1>
          <p>출근하고, 자리에서 일하고, 회의실에 모여 회의하고, 대표실로 보고하러 갑니다.</p>
        </div>
        <div className="live-clock">
          <span>SEOUL · {dayCount}일차</span>
          <b>{snap.clock}</b>
          <small>{snap.phase}</small>
        </div>
      </header>

      <section className="live-bar">
        <button className="btn btn-primary" onClick={onStart} disabled={snap.running}>
          {snap.running ? "직원들이 일하는 중…" : snap.dayComplete ? "다시 출근시키기" : "오늘 업무 시작하기"}
        </button>
        <button
          className={`btn btn-ghost ${autoLoop ? "on" : ""}`}
          onClick={onToggleAutoLoop}
          title="켜두면 하루가 끝나도 쉬지 않고 바로 다음날을 시작해요. 하루치 보고서도 그때마다 자동으로 다운로드돼요."
        >
          {autoLoop ? "🔁 무한 반복 ON" : "🔁 무한 반복 OFF"}
        </button>
        <button className="btn btn-ghost" onClick={() => engine.togglePause()}>
          {snap.paused ? "▶ 재생" : "⏸ 일시정지"}
        </button>
        <div className="speed-wrap">
          <span className="speed-label" title="시뮬레이션 전체(걷기·업무·대사)가 함께 빨라져요. 실제 외부 작업 속도와는 무관합니다.">
            재생 속도
          </span>
          <div className="speed-group" role="group" aria-label="재생 속도">
            {[1, 2, 4].map((value) => (
              <button
                key={value}
                className={!snap.turbo && snap.speed === value ? "on" : ""}
                onClick={() => engine.setSpeed(value)}
                title={value === 1 ? "말풍선 읽기·화면녹화용" : value === 4 ? "결과만 빠르게" : "기본"}
              >
                {value}x
              </button>
            ))}
            <button
              className={`skip ${snap.turbo ? "on" : ""}`}
              onClick={() => engine.skipToDecision()}
              disabled={!snap.running || snap.approvalPending}
              title="대표님이 결정할 일이 생길 때까지 단숨에 건너뜁니다"
            >
              {snap.turbo ? "건너뛰는 중…" : "⏭ 결정까지"}
            </button>
          </div>
        </div>
        <button className={`btn btn-ghost ${follow ? "on" : ""}`} onClick={() => setFollow(!follow)}>
          🎥 자동 추적 {follow ? "ON" : "OFF"}
        </button>
        <button
          className={`btn btn-ghost publish-btn ${publishResult ? "sent" : ""}`}
          onClick={onPublish}
          disabled={publishBusy}
          title="완료 보고를 준비해서 감사팀이 다운로드할 수 있도록 알립니다"
        >
          {publishBusy ? "준비 중…" : "📤 보고 발행"}
        </button>
        <button
          className="btn btn-ghost"
          onClick={onDownload}
          title="지금까지 진행 상황을 텍스트 파일로 내 컴퓨터에 저장합니다"
        >
          📥 보고서 다운로드
        </button>
        <div className="live-progress">
          <span>
            {snap.phase} · {progress}%
          </span>
          <i>
            <b style={{ width: `${progress}%` }} />
          </i>
        </div>
        <div className="live-counts">
          <span className="lc on-duty">근무 {onDuty}</span>
          <span className="lc done">완료 {snap.stats.done}</span>
          <span className="lc working">진행 {snap.stats.working}</span>
          <span className="lc blocked">연동대기 {snap.stats.blocked}</span>
        </div>
      </section>

      <section className="live-grid">
        <OfficeWorld engine={engine} snap={snap} selectedId={selectedId} follow={follow} onSelect={onSelect} />

        <aside className="live-rail">
          <CeoConsole engine={engine} snap={snap} />

          <AiMorningMeetingPanel engine={engine} snap={snap} />

          {snap.approvalPending ? (
            <section className="win rail-card" id="ceo-content-approval">
              <div className="win-bar">
                <span>✅ ceo.approval · 콘텐츠</span>
                <span className="window-controls">—　▢　✕</span>
              </div>
              <div className="win-body approval-body pending">
                <div className="approval-top">
                  <span className="mini-badge yellow">TOP 1 제안 · 92점</span>
                  <span className="score blink">결재 대기</span>
                </div>
                <h3>AI 회사가 매일 아침 나 대신 출근한다면?</h3>
                <p>회의실에서 최아름·한도빈·김세리가 대표님을 기다리고 있어요.</p>
                <div className="reason-list">
                  <span>① 실제 구축 과정</span>
                  <span>② 저장할 운영 구조</span>
                  <span>③ 날것의 시행착오</span>
                </div>
                <button className="btn approve-button" onClick={onApprove}>
                  이 콘텐츠 승인하기
                </button>
              </div>
            </section>
          ) : null}

          {snap.approved && snap.contentPlan ? <AiWriterPanel plan={snap.contentPlan} /> : null}

          <section className="win rail-card feed-card">
            <div className="win-bar">
              <span>📡 live.feed</span>
              <span className="window-controls">—　▢　✕</span>
            </div>
            <div className="win-body feed-body">
              {snap.meetingTitle ? <div className="feed-now">💬 회의 진행 중 — {snap.meetingTitle}</div> : null}
              <ul className="feed-list">
                {snap.log.map((entry) => (
                  <li key={entry.id} className={entry.tone}>
                    <b>{entry.time}</b>
                    <i>{entry.icon}</i>
                    <span>{entry.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <section className="win rail-card">
            <div className="win-bar">
              <span>👥 staff.roster</span>
              <span className="window-controls">—　▢　✕</span>
            </div>
            <div className="win-body roster-body">
              {DEPT_ROOMS.map((room) => (
                <div className="roster-dept" key={room.id}>
                  <p>
                    <b>
                      {room.icon} {room.name}
                    </b>
                    <i className={`rm-dot ${statusClass[snap.deptStatus[room.id] ?? "대기"]}`} />
                  </p>
                  <div className="roster-chips">
                    {STAFF.filter((s) => s.deptId === room.id).map((seed) => {
                      const agent = engine.agentById.get(seed.id);
                      return (
                        <button
                          key={seed.id}
                          className={`roster-chip ${selectedId === seed.id ? "on" : ""}`}
                          onClick={() => agent && onSelect(agent)}
                        >
                          <i style={{ background: seed.shirt, borderColor: seed.hair }} />
                          {seed.name}
                          <small>{agent?.status ?? "출근 전"}</small>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </section>
    </>
  );
}

const QUICK_ORDERS = [
  { label: "현황 보고", command: "현황 보고해줘" },
  { label: "왜 늦어져?", command: "왜 늦어지고 있어?" },
  { label: "회의 소집", command: "전 부서 회의 소집" },
  { label: "지금 브리핑", command: "지금 브리핑 올라와" },
  { label: "집중 모드", command: "집중 모드" },
  { label: "속도 올려", command: "속도 좀 올려줘" },
];

function CeoConsole({ engine, snap }: { engine: Company; snap: Snapshot }) {
  const [draft, setDraft] = useState("");
  const logRef = useRef<HTMLDivElement>(null);
  const count = snap.chat.length;

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [count]);

  const send = (text: string) => {
    const value = text.trim();
    if (!value) return;
    engine.command(value);
    setDraft("");
  };

  return (
    <section className="win rail-card console-card" id="ceo-console">
      <div className="win-bar">
        <span>🎤 ceo.console — 대표 지시창</span>
        <span className="window-controls">—　▢　✕</span>
      </div>
      <div className="win-body console-body">
        <div className="console-status">
          <span className={`mini-badge ${snap.focusMode ? "yellow" : "mint"}`}>
            {snap.focusMode ? "집중 모드 ON" : "평시 운영"}
          </span>
          {snap.busyWithOrder ? <span className="mini-badge lav">지시 처리 중…</span> : null}
        </div>

        <div className="console-log" ref={logRef}>
          {snap.chat.map((entry) => (
            <div key={entry.id} className={`console-line ${entry.from}`}>
              <b>{entry.from === "ceo" ? "대표님" : entry.name}</b>
              <p>{entry.text}</p>
              <small>{entry.time}</small>
            </div>
          ))}
        </div>

        <div className="console-quick">
          {QUICK_ORDERS.map((item) => (
            <button key={item.label} onClick={() => send(item.command)}>
              {item.label}
            </button>
          ))}
        </div>

        <form
          className="console-input"
          onSubmit={(event) => {
            event.preventDefault();
            send(draft);
          }}
        >
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="예: 캐러셀팀 지금 뭐해? / 왜 늦어져?"
            aria-label="대표 지시 입력"
          />
          <button type="submit">지시</button>
        </form>
      </div>
    </section>
  );
}

function ProfileModal({
  agent,
  onClose,
  onAsk,
}: {
  agent: Agent;
  onClose: () => void;
  onAsk: (agent: Agent) => void;
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        className="win team-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`${agent.name} 프로필`}
      >
        <div className="win-bar">
          <span>👤 employee_profile.exe</span>
          <button className="window-close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="win-body employee-profile">
          <div className="profile-top">
            <PixelEmployee hair={agent.hair} shirt={agent.shirt} accent={agent.accent} />
            <div>
              <span className="status-pill working">{agent.status}</span>
              <h2>
                {agent.name}
                {agent.callsign ? <small> · {agent.callsign}</small> : null}
              </h2>
              <p>{agent.role}</p>
            </div>
          </div>
          <div className="profile-task">
            <span className="tiny-label">지금 하는 일</span>
            <strong>{agent.taskLabel}</strong>
            {agent.anim === "type" ? (
              <span className="profile-progress">
                <i style={{ width: `${Math.round(agent.progress * 100)}%` }} />
              </span>
            ) : null}
          </div>
          <div className="report-box">
            <span className="tiny-label">한마디</span>
            <strong>{agent.speech ?? agent.thoughts[0]}</strong>
          </div>
          <div className="profile-actions">
            <button className="btn btn-primary" onClick={() => onAsk(agent)}>
              🎤 지금 뭐 하는지 물어보기
            </button>
            <button className="text-button" onClick={onClose}>
              닫기
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function BriefingModal({ snap, onClose }: { snap: Snapshot; onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        className="win team-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="김비서 브리핑"
      >
        <div className="win-bar">
          <span>📋 kim_secretary.brief</span>
          <button className="window-close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="win-body">
          <p className="brief-date">{snap.clock} · 김세리 비서실장 최종 브리핑</p>
          <h3>대표님, 오늘 회사 업무가 정리됐어요.</h3>
          <ul>
            <li>
              <span className="dot green" />
              완료 {snap.stats.done}팀 — 조사·기획·QA·대본·제작·저장까지 마쳤어요
            </li>
            <li>
              <span className="dot green" />
              대표 승인 1건 반영 — TOP 1 콘텐츠 제작 완료
            </li>
            <li>
              <span className="dot gray" />
              연동 대기 {snap.stats.blocked}팀 — 외부 서비스 연결이 필요해요
            </li>
          </ul>
          <div className="decision-box">
            <span className="tiny-label">오늘 대표님이 결정할 것</span>
            <strong>없습니다. 내일 07:00에 다시 출근할게요 ✨</strong>
          </div>
          <button className="btn btn-primary" onClick={onClose}>
            확인
          </button>
        </div>
      </section>
    </div>
  );
}

type TeamRow = {
  id: string;
  icon: string;
  name: string;
  room: string;
  lead: (typeof DEPT_LEAD)[string];
  status: DeptStatus;
  task: string;
  report: string;
};

const GSC_RANGE_OPTIONS: { label: string; days: number }[] = [
  { label: "7일", days: 7 },
  { label: "28일", days: 28 },
  { label: "90일", days: 90 },
];

/** SEO 분석팀 — 실제 Search Console 데이터 (연동 전엔 정직하게 "연동 대기"만 보여준다) */
function SearchConsolePanel() {
  const [connection] = useSearchConsoleStore(searchConsoleConnectionStore);
  const [panel] = useSearchConsoleStore(searchConsolePanelStore);
  const [rangeDays, setRangeDays] = useState(28);

  const onRefresh = useCallback((days: number) => {
    setRangeDays(days);
    void loadSearchConsoleData(days);
  }, []);

  const connected = connection.status?.connected ?? false;

  return (
    <section className="win">
      <div className="win-bar">
        <span>📊 seo.room · Search Console</span>
        <span className="window-controls">—　▢　✕</span>
      </div>
      <div className="win-body">
        {connection.checking ? (
          <p className="brief-date">연동 상태 확인 중…</p>
        ) : !connected ? (
          <div className="decision-box">
            <span className="tiny-label">SEO 분석팀 · 연동 대기</span>
            <strong>
              {connection.status?.reason ?? "Search Console이 아직 연동되지 않았어요."}
            </strong>
            <p style={{ marginTop: 8, fontSize: 13, opacity: 0.8 }}>
              지표 없이 순위를 지어내지 않아요. SEARCH_CONSOLE_SETUP.md 안내대로 연동하면 이 자리에
              실제 클릭수·노출수·CTR·평균순위가 표시됩니다.
            </p>
          </div>
        ) : (
          <>
            <div className="section-heading">
              <div>
                <p className="eyebrow">LIVE · {connection.status?.siteUrl}</p>
                <h2>검색 성과 (최근 {rangeDays}일)</h2>
              </div>
              <div className="filter-tabs" role="group" aria-label="조회 기간">
                {GSC_RANGE_OPTIONS.map((opt) => (
                  <button
                    key={opt.days}
                    className={rangeDays === opt.days ? "active" : ""}
                    onClick={() => onRefresh(opt.days)}
                    disabled={panel.busy}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {panel.error ? (
              <p className="brief-date" style={{ color: "#c0546b" }}>
                {panel.error}
              </p>
            ) : null}

            {panel.busy && !panel.queries ? (
              <p className="brief-date">지표 불러오는 중…</p>
            ) : (
              <>
                <section className="summary-grid" aria-label="검색 성과 요약">
                  <article className="metric mint">
                    <span>클릭수</span>
                    <strong>{panel.queries?.totals.clicks.toLocaleString() ?? "—"}</strong>
                    <small>CLICKS</small>
                  </article>
                  <article className="metric pink">
                    <span>노출수</span>
                    <strong>{panel.queries?.totals.impressions.toLocaleString() ?? "—"}</strong>
                    <small>IMPRESSIONS</small>
                  </article>
                  <article className="metric lav">
                    <span>CTR</span>
                    <strong>{panel.queries ? `${(panel.queries.totals.ctr * 100).toFixed(1)}%` : "—"}</strong>
                    <small>CTR</small>
                  </article>
                  <article className="metric white">
                    <span>평균순위</span>
                    <strong>{panel.queries ? panel.queries.totals.position.toFixed(1) : "—"}</strong>
                    <small>POSITION</small>
                  </article>
                </section>

                <div className="result-table">
                  <div className="result-row header">
                    <span>검색어</span>
                    <span>클릭</span>
                    <span>노출</span>
                    <span>순위</span>
                  </div>
                  {(panel.queries?.items ?? []).slice(0, 8).map((row) => (
                    <div className="result-row" key={row.keys.join("|")}>
                      <b>{row.keys[0] ?? "-"}</b>
                      <span>{row.clicks}</span>
                      <span>{row.impressions}</span>
                      <span>{row.position.toFixed(1)}</span>
                    </div>
                  ))}
                  {panel.queries && panel.queries.items.length === 0 ? (
                    <p className="brief-date">이 기간에는 검색 데이터가 없어요.</p>
                  ) : null}
                </div>

                {panel.lastFetchedAt ? (
                  <p className="brief-date">마지막 갱신: {new Date(panel.lastFetchedAt).toLocaleString("ko-KR")}</p>
                ) : null}
              </>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function DashboardView({
  teams,
  filteredTeams,
  filter,
  setFilter,
  snap,
  onStart,
  onApprove,
  onSelect,
  integrations,
  publishResult,
}: {
  teams: TeamRow[];
  filteredTeams: TeamRow[];
  filter: "전체" | DeptStatus;
  setFilter: (value: "전체" | DeptStatus) => void;
  snap: Snapshot;
  onStart: () => void;
  onApprove: () => void;
  onSelect: (id: string) => void;
  integrations: IntegrationStatus | null;
  publishResult: PublishResult | null;
}) {
  const [gscConnection] = useSearchConsoleStore(searchConsoleConnectionStore);

  // Notion·Discord 같은 외부 서비스로 자동 전송하지 않는다. 보고서는 감사팀이 직접
  // 다운로드하도록 하고, 나머지는 아직 실제로 연동이 안 된 항목만 "대기"로 정직하게 표시한다.
  const gscRow = gscConnection.checking
    ? { name: "Search Console (SEO 분석팀)", status: "확인 중…", tone: "lav", href: "" }
    : gscConnection.status?.connected
      ? { name: "Search Console (SEO 분석팀)", status: "연동됨", tone: "mint", href: "" }
      : {
          name: "Search Console (SEO 분석팀)",
          status: gscConnection.status?.reason ? "연동 대기" : "미설정",
          tone: "lav",
          href: "",
        };

  const liveRows = integrations
    ? [
        {
          name: "일일 보고서 (감사팀용)",
          status: publishResult?.ready ? "다운로드 가능" : "발행 전",
          tone: publishResult?.ready ? "mint" : "lav",
          href: "",
        },
        gscRow,
        { name: "Instagram", status: integrations.instagram?.need ?? "연동 대기", tone: "lav", href: "" },
        { name: "Gmail", status: integrations.gmail?.need ?? "연동 대기", tone: "lav", href: "" },
        { name: "재무 파일", status: integrations.finance?.need ?? "자료 대기", tone: "lav", href: "" },
      ]
    : [gscRow];
  const rows = [...integrations2Static, ...liveRows];

  return (
    <>
      <header className="win hero">
        <div className="win-bar">
          <span>🎀 {COMPANY.windowLabel}</span>
          <span className="window-controls" aria-hidden="true">
            —　▢　✕
          </span>
        </div>
        <div className="hero-body">
          <div className="hero-copy">
            <p className="eyebrow">TODAY · 07:00 AUTO START</p>
            <h1>
              오늘 회사가 어떻게 움직이는지 <em className="highlight">한눈에</em> 보여드려요
            </h1>
            <p>AI는 비서, 결정은 대표님. 12개 팀 32명의 조사부터 제작·저장·브리핑까지 한 흐름으로 관리해요.</p>
          </div>
          <div className="hero-actions">
            <button className="btn btn-primary" onClick={onStart} disabled={snap.running}>
              {snap.running ? "AI 팀원들이 근무 중…" : "오늘 업무 시작하기"}
            </button>
            <span className="trust-copy">실제 전송·게시·결제는 대표 승인 후 진행해요</span>
          </div>
        </div>
      </header>

      <section className="summary-grid" aria-label="오늘 업무 요약">
        <article className="metric yellow">
          <span>AI 직원</span>
          <strong>32</strong>
          <small>STAFF</small>
        </article>
        <article className="metric mint">
          <span>완료</span>
          <strong>{snap.stats.done}</strong>
          <small>DONE</small>
        </article>
        <article className="metric pink">
          <span>진행 중</span>
          <strong>{snap.stats.working}</strong>
          <small>WORKING</small>
        </article>
        <article className="metric lav">
          <span>대표 확인</span>
          <strong>{snap.stats.approval}</strong>
          <small>APPROVAL</small>
        </article>
        <article className="metric white">
          <span>연동 대기</span>
          <strong>{snap.stats.blocked}</strong>
          <small>WAITING</small>
        </article>
      </section>

      <section className="workspace">
        <aside className="side-stack">
          <section className="win">
            <div className="win-bar">
              <span>⚡ automation.status</span>
              <span className="window-controls">—　▢　✕</span>
            </div>
            <div className="win-body">
              <div className="schedule-card">
                <div>
                  <span className="tiny-label">NEXT RUN</span>
                  <strong>매일 오전 7:00</strong>
                  <p>컴퓨터 지시 없이 하루 업무 시작</p>
                </div>
                <span className="toggle-on">ON</span>
              </div>
              <div className="flow-list">
                {PHASES.slice(1, 12).map((item, index) => (
                  <div className={`flow-row ${snap.phaseIndex > index + 1 ? "past" : ""}`} key={item}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <b>{item}</b>
                    <i>{snap.phaseIndex === index + 1 ? "●" : snap.phaseIndex > index + 1 ? "✓" : "·"}</i>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="win">
            <div className="win-bar">
              <span>🔗 integrations.link</span>
              <span className="window-controls">—　▢　✕</span>
            </div>
            <div className="win-body integration-list">
              {rows.map((item) =>
                item.href ? (
                  <a key={item.name} href={item.href} target="_blank" rel="noreferrer" className="integration-row">
                    <b>{item.name}</b>
                    <span className={`mini-badge ${item.tone}`}>{item.status}</span>
                  </a>
                ) : (
                  <div key={item.name} className="integration-row">
                    <b>{item.name}</b>
                    <span className={`mini-badge ${item.tone}`}>{item.status}</span>
                  </div>
                ),
              )}
            </div>
          </section>
        </aside>

        <div className="main-stack">
          <section className="win">
            <div className="win-bar">
              <span>🏢 team_office.board</span>
              <span className="window-controls">—　▢　✕</span>
            </div>
            <div className="win-body">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">LIVE OFFICE</p>
                  <h2>12개 부서 · 팀장 12명 근무 현황</h2>
                </div>
                <div className="filter-tabs" role="group" aria-label="팀 상태 필터">
                  {(["전체", "진행 중", "완료", "승인 대기", "연동 대기"] as const).map((item) => (
                    <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>
                      {item}
                    </button>
                  ))}
                </div>
              </div>
              <div className="team-grid">
                {filteredTeams.map((team) => (
                  <button className="team-card" key={team.id} onClick={() => onSelect(team.lead.id)}>
                    <span className={`status-dot ${statusClass[team.status]}`} aria-hidden="true" />
                    <span className="mini-pixel">
                      <PixelEmployee hair={team.lead.hair} shirt={team.lead.shirt} accent={team.lead.accent} />
                    </span>
                    <span className="team-copy">
                      <b>
                        {team.lead.name} · {team.name}
                      </b>
                      <small>{team.task}</small>
                    </span>
                    <span className={`status-pill ${statusClass[team.status]}`}>{team.status}</span>
                  </button>
                ))}
              </div>
            </div>
          </section>

          <SearchConsolePanel />

          <section className="two-col">
            <section className="win">
              <div className="win-bar">
                <span>✅ ceo.approval</span>
                <span className="window-controls">—　▢　✕</span>
              </div>
              <div className="win-body approval-body">
                <div className="approval-top">
                  <span className="mini-badge yellow">TOP 1 제안</span>
                  <span className="score">92점</span>
                </div>
                <h3>
                  AI 회사가 매일 아침
                  <br />
                  나 대신 출근한다면?
                </h3>
                <p>지금 만들고 있는 시스템 자체를 날것의 성장기로 공개하는 크리에이터 아이덴티티 콘텐츠예요.</p>
                <button
                  className={`btn approve-button ${snap.approved ? "approved" : ""}`}
                  onClick={onApprove}
                  disabled={!snap.approvalPending}
                >
                  {snap.approved ? "승인 완료 · 제작팀 전달됨" : snap.approvalPending ? "이 콘텐츠 승인하기" : "대기 중인 안건 없음"}
                </button>
              </div>
            </section>

            <section className="win secretary">
              <div className="win-bar">
                <span>📋 kim_secretary.brief</span>
                <span className="window-controls">—　▢　✕</span>
              </div>
              <div className="win-body">
                <p className="brief-date">2026.07.26 · {snap.clock} 현재</p>
                <h3>{snap.dayComplete ? "대표님, 오늘 업무가 정리됐어요." : "대표님, 현재 진행 상황이에요."}</h3>
                <ul>
                  <li>
                    <span className="dot green" />
                    {snap.phase} 진행 중 — 완료 {snap.stats.done}팀
                  </li>
                  <li>
                    <span className={`dot ${snap.approvalPending ? "yellow" : "green"}`} />
                    {snap.approvalPending ? "TOP 1 대표 확인 필요" : "대기 중인 결재 없음"}
                  </li>
                  <li>
                    <span className="dot gray" />
                    외부 서비스 연동 대기
                  </li>
                </ul>
                <div className="decision-box">
                  <span className="tiny-label">대표님이 오늘 결정할 1개</span>
                  <strong>
                    {snap.approvalPending
                      ? "TOP 1 콘텐츠를 제작할지 승인해주세요."
                      : snap.approved
                        ? "결정 완료! 제작팀이 다음 업무를 진행해요."
                        : "아직 올라온 안건이 없어요."}
                  </strong>
                </div>
              </div>
            </section>
          </section>
        </div>
      </section>

      <section className="win storage">
        <div className="win-bar">
          <span>📦 result_storage</span>
          <span className="window-controls">—　▢　✕</span>
        </div>
        <div className="win-body">
          <div className="section-heading">
            <div>
              <p className="eyebrow">RECENT OUTPUTS</p>
              <h2>결과물 창고</h2>
            </div>
            {STORAGE_LINK ? (
              <a className="btn btn-small" href={STORAGE_LINK} target="_blank" rel="noreferrer">
                보관함 열기
              </a>
            ) : null}
          </div>
          <div className="result-table">
            <div className="result-row header">
              <span>결과물</span>
              <span>담당팀</span>
              <span>상태</span>
              <span>바로가기</span>
            </div>
            <div className="result-row">
              <b>이번 주 콘텐츠 캘린더 정리</b>
              <span>기획 1팀</span>
              <span className="status-pill done">최종 완료</span>
              <span>—</span>
            </div>
            <div className="result-row">
              <b>브랜드 템플릿 세팅</b>
              <span>이미지 제작팀</span>
              <span className="status-pill done">최종 완료</span>
              <span>—</span>
            </div>
          </div>
        </div>
      </section>

      <p className="dash-note">
        대표 {CEO.name}({CEO.callsign}) · AI 직원 {teams.length}개 부서 32명 · 이 화면은 라이브 오피스와 같은 상태를
        공유해요.
      </p>
    </>
  );
}
