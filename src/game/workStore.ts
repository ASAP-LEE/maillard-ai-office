// src/game/workStore.ts
// 탭(라이브 오피스 / 실시간 진짜 회사)을 오가도, 그리고 새로고침을 해도 승인 진행 상황과
// 완료 이력이 사라지지 않도록 React 컴포넌트 밖, 모듈 레벨에 상태를 둔다.
// auditStore.ts와 같은 구독 패턴 위에, localStorage에 값을 미러링하는 기능을 얹었다.
//
// - 컴포넌트가 언마운트/재마운트되어도(=탭을 옮겨도) 이 모듈은 그대로 메모리에 남아있다.
// - 값이 바뀔 때마다 localStorage에도 저장하므로, 새로고침하거나 탭을 다시 열어도 복원된다.
// - 단, API 키는 보안상 localStorage에 저장하지 않는다 (메모리 전용 makeStore 사용).
//   이 사이트는 서버가 없는 정적 사이트라, 키까지 저장하려면 브라우저에 평문으로 남게 되어
//   다른 사람이 같은 기기를 쓰거나 XSS가 있으면 키가 노출될 위험이 있기 때문.

import { useSyncExternalStore } from "react";
import type { ContentProposal, DeptDailyReport, ReviewResult } from "./agentPipeline";

type Subscriber = () => void;

export type Store<T> = {
  get: () => T;
  set: (updater: T | ((prev: T) => T)) => void;
  subscribe: (cb: Subscriber) => () => void;
};

export function makeStore<T>(initial: T): Store<T> {
  let state = initial;
  const subs: Subscriber[] = [];
  return {
    get: () => state,
    set: (updater: T | ((prev: T) => T)) => {
      state = typeof updater === "function" ? (updater as (prev: T) => T)(state) : updater;
      subs.forEach((s) => s());
    },
    subscribe: (cb: Subscriber) => {
      subs.push(cb);
      return () => {
        const i = subs.indexOf(cb);
        if (i > -1) subs.splice(i, 1);
      };
    },
  };
}

/**
 * 페이지를 새로고침하면 진행 중이던 AI 호출(fetch)은 끊기지만, busy:true 같은 값은
 * localStorage에 그대로 남아있을 수 있다. 그 상태로 복원되면 "로딩 중" 화면에 영원히
 * 갇히므로, 복원 직후 busy만 false로 되돌려 사용자가 다시 시도할 수 있게 한다.
 */
export function resetBusyOnRestore<T extends { busy: boolean }>(store: Store<T>): Store<T> {
  if (store.get().busy) {
    store.set((s) => ({ ...s, busy: false }));
  }
  return store;
}

const STORAGE_PREFIX = "maillard.work.";

/** localStorage에 있으면 그 값을, 없거나 읽기 실패하면 fallback을 반환한다 */
function readPersisted<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + key);
    if (raw == null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * makeStore와 동일하지만, 값이 바뀔 때마다 localStorage에도 저장하고 초기값은
 * localStorage에서 먼저 읽어온다. 새로고침해도(=페이지를 완전히 다시 불러와도)
 * 진행 상황과 이력이 그대로 남아있게 하기 위함.
 *
 * ⚠️ API 키처럼 민감한 값은 이 함수를 쓰지 않고 makeStore()만 사용해 메모리에만 둔다.
 */
export function makePersistedStore<T>(key: string, initial: T): Store<T> {
  const restored = readPersisted<T>(key, initial);
  const base = makeStore<T>(restored);
  const storageKey = STORAGE_PREFIX + key;

  const persist = (value: T) => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(value));
    } catch {
      // 저장 실패(용량 초과 등)는 조용히 무시 — 메모리 상의 상태는 정상 동작한다
    }
  };

  return {
    get: base.get,
    subscribe: base.subscribe,
    set: (updater: T | ((prev: T) => T)) => {
      base.set(updater);
      persist(base.get());
    },
  };
}

/** 모듈 레벨 스토어를 React 컴포넌트에서 구독하는 훅. 탭이 바뀌어도(=컴포넌트가
 * 재마운트되어도) 스토어 자체는 살아있으므로 최신 값을 그대로 다시 읽어온다. */
export function useStore<T>(store: Store<T>): [T, Store<T>["set"]] {
  const value = useSyncExternalStore(store.subscribe, store.get, store.get);
  return [value, store.set];
}

// ---------------------------------------------------------------------------
// API 키 — 한 번 입력하면 탭을 옮겨 다녀도 다시 물어보지 않는다 (새로고침 전까지)
// ---------------------------------------------------------------------------
export const apiKeyStore = makeStore<string>("");

// ---------------------------------------------------------------------------
// "실시간 진짜 회사" 탭 — 12개 부서 순차 승인 (all.depts.approval)
// ---------------------------------------------------------------------------
export type DeptApprovalState = {
  deptIndex: number;
  report: DeptDailyReport | null;
  busy: boolean;
  error: string;
  showInstructionBox: boolean;
  instruction: string;
  approvedCount: number;
  started: boolean;
};

export const INITIAL_DEPT_APPROVAL_STATE: DeptApprovalState = {
  deptIndex: 0,
  report: null,
  busy: false,
  error: "",
  showInstructionBox: false,
  instruction: "",
  approvedCount: 0,
  started: false,
};

export const deptApprovalStore = resetBusyOnRestore(
  makePersistedStore<DeptApprovalState>("deptApproval", { ...INITIAL_DEPT_APPROVAL_STATE }),
);
export const deptApprovalHistoryStore = makePersistedStore<{ dept: string; summary: string }[]>("deptApprovalHistory", []);

// ---------------------------------------------------------------------------
// "실시간 진짜 회사" 탭 — 기획→작성→검수 파이프라인 (real.company)
// ---------------------------------------------------------------------------
export type PipelineStage = "briefing" | "working" | "reviewing" | "done";

export type PipelineState = {
  stage: PipelineStage;
  proposal: ContentProposal | null;
  draft: string | null;
  review: ReviewResult | null;
  busy: boolean;
  error: string;
  showInstructionBox: boolean;
  instruction: string;
  retryCount: number;
  started: boolean;
};

export const INITIAL_PIPELINE_STATE: PipelineState = {
  stage: "briefing",
  proposal: null,
  draft: null,
  review: null,
  busy: false,
  error: "",
  showInstructionBox: false,
  instruction: "",
  retryCount: 0,
  started: false,
};

export const pipelineStore = resetBusyOnRestore(
  makePersistedStore<PipelineState>("pipeline", { ...INITIAL_PIPELINE_STATE }),
);
export const publishedTitlesStore = makePersistedStore<string[]>("publishedTitles", []);
export const finalDraftsStore = makePersistedStore<{ title: string; markdown: string }[]>("finalDrafts", []);

// ---------------------------------------------------------------------------
// "라이브 오피스" 탭 — 아침 회의 승인 패널 (ceo.approval)
// ---------------------------------------------------------------------------
export type MorningPanelState = {
  report: DeptDailyReport | null;
  busy: boolean;
  error: string;
  showInstructionBox: boolean;
  instruction: string;
  requestedForDept: string | null;
};

export const INITIAL_MORNING_PANEL_STATE: MorningPanelState = {
  report: null,
  busy: false,
  error: "",
  showInstructionBox: false,
  instruction: "",
  requestedForDept: null,
};

// morningPanelStore는 sim.ts의 Company 엔진(회의실 씬)과 실시간으로 맞물려 동작한다.
// 새로고침하면 엔진도 처음부터 다시 시작되므로(morningSpeakerDeptId 등 초기화), 이 진행중
// 상태까지 localStorage에서 복원하면 오히려 씬과 어긋나 보일 수 있어 탭 전환 동안만 유지되는
// 메모리 전용 스토어로 둔다. 반면 "이미 승인 완료된 이력"은 새로고침 후에도 남아야 하므로 영속화한다.
export const morningPanelStore = makeStore<MorningPanelState>({ ...INITIAL_MORNING_PANEL_STATE });
export const morningApprovedCountStore = makePersistedStore<number>("morningApprovedCount", 0);
export const morningHistoryStore = makePersistedStore<{ dept: string; summary: string }[]>("morningHistory", []);

// ---------------------------------------------------------------------------
// 완료 알림 — 어떤 작업이든 "완료"되면 여기 쌓인다.
// 브라우저 알림(Notification API)도 같이 띄우고, 사용자는 알림 목록에서
// 완료된 내용을 바로 다운로드할 수 있다.
// ---------------------------------------------------------------------------
export type CompletionNotification = {
  id: string;
  timestamp: string;
  title: string;
  summary: string;
  /** 다운로드 가능한 본문 (마크다운 원고, 보고 내용 등) */
  content: string;
  /** 다운로드 파일명에 쓸 확장자 포함 안 된 이름 */
  filenameBase: string;
  /** 다운로드 파일 확장자 (.md, .txt 등) */
  fileExt: string;
  read: boolean;
};

let notifIdCounter = 0;
export const completionNotificationsStore = makePersistedStore<CompletionNotification[]>("completionNotifications", []);

/** 브라우저 알림 권한을 요청한다 (이미 허용/거부된 경우 조용히 반환) */
export function requestNotificationPermission(): void {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission === "default") {
    void Notification.requestPermission();
  }
}

/** 작업 완료 알림을 추가하고, 가능하면 브라우저 알림도 띄운다 */
export function addCompletionNotification(input: {
  title: string;
  summary: string;
  content: string;
  filenameBase: string;
  fileExt: string;
}): void {
  notifIdCounter++;
  const entry: CompletionNotification = {
    id: `notif_${Date.now()}_${notifIdCounter}`,
    timestamp: new Date().toISOString(),
    read: false,
    ...input,
  };
  completionNotificationsStore.set((prev) => [entry, ...prev]);

  if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
    try {
      new Notification(`✅ ${input.title}`, {
        body: input.summary,
        tag: entry.id,
      });
    } catch {
      // 알림 생성 실패는 무시 (예: 일부 브라우저/환경 제약)
    }
  }
}

export function markNotificationRead(id: string): void {
  completionNotificationsStore.set((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
}

export function markAllNotificationsRead(): void {
  completionNotificationsStore.set((prev) => prev.map((n) => ({ ...n, read: true })));
}

export function clearNotification(id: string): void {
  completionNotificationsStore.set((prev) => prev.filter((n) => n.id !== id));
}
