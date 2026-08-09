// src/game/searchConsoleStore.ts
// Search Console 연동 상태(연결됐는지) + 최근 조회 결과를 모듈 레벨에 보관한다.
// workStore.ts와 같은 구독 패턴을 그대로 쓴다 (별도 파일로 둔 이유: 이 도메인만
// SEO 분석팀 대시보드 여러 곳에서 쓰이고, workStore.ts는 이미 파이프라인/승인 상태로
// 충분히 크기 때문에 관심사를 분리했다).
//
// ⚠️ 이 스토어는 절대로 "연결 성공"을 낙관적으로 미리 표시하지 않는다.
//    status는 항상 checkSearchConsoleConnection()의 실제 응답을 그대로 반영한다.

import { useSyncExternalStore } from "react";
import { makePersistedStore, makeStore, resetBusyOnRestore, type Store } from "./workStore";
import {
  checkSearchConsoleConnection,
  queryDailyTrend,
  queryTopPages,
  queryTopQueries,
  type SearchConsoleResult,
  type SearchConsoleStatus,
} from "./searchConsole";

export function useStore<T>(store: Store<T>): [T, Store<T>["set"]] {
  const value = useSyncExternalStore(store.subscribe, store.get, store.get);
  return [value, store.set];
}

// ---------------------------------------------------------------------------
// 연동 상태 — 대시보드 "🔗 integrations.link" 패널과 sim.ts가 함께 참조한다.
// ---------------------------------------------------------------------------
export type SearchConsoleConnectionState = {
  /** null = 아직 확인 전, 로딩 UI로 보여준다 */
  status: SearchConsoleStatus | null;
  checking: boolean;
};

export const searchConsoleConnectionStore = makeStore<SearchConsoleConnectionState>({
  status: null,
  checking: false,
});

/** 실제로 Google에 인증을 시도해서 연결 여부를 확인하고 스토어를 갱신한다 */
export async function refreshSearchConsoleConnection(): Promise<SearchConsoleStatus> {
  searchConsoleConnectionStore.set((s) => ({ ...s, checking: true }));
  const status = await checkSearchConsoleConnection();
  searchConsoleConnectionStore.set({ status, checking: false });
  return status;
}

// ---------------------------------------------------------------------------
// 조회 결과 캐시 — 새로고침해도 마지막으로 본 지표가 남아있도록 영속화한다.
// (민감한 키가 아니라 집계된 지표 숫자라 localStorage에 저장해도 안전하다)
// ---------------------------------------------------------------------------
export type SearchConsolePanelState = {
  queries: SearchConsoleResult | null;
  pages: SearchConsoleResult | null;
  trend: SearchConsoleResult | null;
  busy: boolean;
  error: string;
  lastFetchedAt: string | null;
};

export const INITIAL_SEARCH_CONSOLE_PANEL_STATE: SearchConsolePanelState = {
  queries: null,
  pages: null,
  trend: null,
  busy: false,
  error: "",
  lastFetchedAt: null,
};

export const searchConsolePanelStore = resetBusyOnRestore(
  makePersistedStore<SearchConsolePanelState>("searchConsolePanel", { ...INITIAL_SEARCH_CONSOLE_PANEL_STATE }),
);

/** 검색어별 · 페이지별 · 일자별 지표를 한 번에 가져와 스토어에 채운다 */
export async function loadSearchConsoleData(days = 28): Promise<void> {
  searchConsolePanelStore.set((s) => ({ ...s, busy: true, error: "" }));
  try {
    const [queries, pages, trend] = await Promise.all([
      queryTopQueries(days),
      queryTopPages(days),
      queryDailyTrend(days),
    ]);
    searchConsolePanelStore.set({
      queries,
      pages,
      trend,
      busy: false,
      error: "",
      lastFetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    searchConsolePanelStore.set((s) => ({
      ...s,
      busy: false,
      error: err instanceof Error ? err.message : "지표를 불러오지 못했어요.",
    }));
  }
}
