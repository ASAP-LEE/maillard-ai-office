// 실제로 Google Search Console API를 호출해서 검색 성과 지표를 가져오는 모듈.
// 서버(Vercel 함수, api/search-console.js)가 Google 서비스 계정으로 인증하고,
// 이 파일은 그 결과를 프론트엔드가 쓰기 좋은 타입으로 감싸기만 한다.
//
// 이 모듈은 "지금은 SEO 지표 조회"에 쓰이지만, 나중에 AI SEO 분석·키워드 전략에도
// 같은 데이터를 재사용할 수 있도록 원시 항목(SearchConsoleRow)까지 그대로 반환한다.
// (report.ts나 agentPipeline.ts에서 items를 그대로 프롬프트에 넣어 분석시키는 식으로 확장 가능)

import {
  SEARCH_CONSOLE_URL,
  explainFetchFailure,
  isSearchConsoleProxyConfigured,
  proxyNotConfiguredError,
  searchConsoleAuthHeader,
} from "./searchConsoleProxy";

/** Search Console이 지원하는 조회 차원. 검색어별·페이지별·기간별 조회에 각각 대응한다. */
export type SearchConsoleDimension = "query" | "page" | "country" | "device" | "date" | "searchAppearance";

export type SearchConsoleQuery = {
  /** YYYY-MM-DD */
  startDate: string;
  /** YYYY-MM-DD */
  endDate: string;
  dimensions?: SearchConsoleDimension[];
  rowLimit?: number;
  startRow?: number;
};

/** 조회 결과 한 줄 (예: 검색어 하나, 페이지 하나, 날짜 하루) */
export type SearchConsoleRow = {
  /** dimensions 순서에 대응하는 값들. 예: dimensions=["query","page"]면 [검색어, 페이지주소] */
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

export type SearchConsoleResult = {
  siteUrl: string;
  dimensions: SearchConsoleDimension[];
  /** 조회 구간 전체 합계 (클릭수·노출수·CTR·평균순위) */
  totals: { clicks: number; impressions: number; ctr: number; position: number };
  rowCount: number;
  items: SearchConsoleRow[];
  fetchedAt: string;
};

export type SearchConsoleStatus = {
  connected: boolean;
  siteUrl?: string;
  checkedAt?: string;
  /** 연결 안 됐을 때 사람이 읽을 수 있는 이유 */
  reason?: string;
  /** configuration_error일 때 어떤 환경변수가 비었는지 */
  missing?: string[];
};

class SearchConsoleError extends Error {
  kind: string;
  constructor(message: string, kind: string) {
    super(message);
    this.kind = kind;
  }
}

async function callProxy(body: Record<string, unknown> | null, method: "GET" | "POST"): Promise<any> {
  if (!isSearchConsoleProxyConfigured()) throw proxyNotConfiguredError();

  let resp: Response;
  try {
    resp = await fetch(SEARCH_CONSOLE_URL, {
      method,
      headers: {
        "content-type": "application/json",
        authorization: searchConsoleAuthHeader(),
      },
      body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
    });
  } catch {
    throw explainFetchFailure();
  }

  const data = await resp.json().catch(() => null);

  if (!data) {
    throw new SearchConsoleError("Search Console 서버 응답을 해석할 수 없어요.", "upstream_error");
  }

  if (!resp.ok || data.ok === false) {
    throw new SearchConsoleError(data.error ?? `HTTP ${resp.status}`, data.kind ?? "upstream_error");
  }

  return data;
}

/**
 * 실제로 연결이 되어 있는지 확인한다 (지표를 가져오지 않고 인증만 검증).
 * 절대로 "일단 성공으로 보여주기"를 하지 않는다 — 서버가 실제로 Google 토큰 발급에
 * 성공했을 때만 connected: true를 반환한다.
 */
export async function checkSearchConsoleConnection(): Promise<SearchConsoleStatus> {
  if (!isSearchConsoleProxyConfigured()) {
    return { connected: false, reason: "프록시 주소 또는 접근 토큰이 설정되지 않았어요." };
  }

  try {
    const data = await callProxy(null, "GET");
    return { connected: true, siteUrl: data.siteUrl, checkedAt: data.checkedAt };
  } catch (err) {
    const e = err as SearchConsoleError;
    return {
      connected: false,
      reason: e.message,
      missing: (err as { missing?: string[] })?.missing,
    };
  }
}

/** 클릭수/노출수/CTR/평균순위 + 검색어별·페이지별·기간별 상세를 조회한다 */
export async function querySearchConsole(query: SearchConsoleQuery): Promise<SearchConsoleResult> {
  const data = await callProxy(
    {
      startDate: query.startDate,
      endDate: query.endDate,
      dimensions: query.dimensions ?? ["date"],
      rowLimit: query.rowLimit ?? 100,
      startRow: query.startRow ?? 0,
    },
    "POST",
  );

  return {
    siteUrl: data.siteUrl,
    dimensions: data.dimensions,
    totals: data.totals,
    rowCount: data.rowCount,
    items: data.items,
    fetchedAt: data.fetchedAt,
  };
}

/** 최근 N일 검색어별 성과 (SEO 분석팀 대시보드 기본 조회) */
export async function queryTopQueries(days = 28, rowLimit = 25): Promise<SearchConsoleResult> {
  const { startDate, endDate } = lastNDaysRange(days);
  return querySearchConsole({ startDate, endDate, dimensions: ["query"], rowLimit });
}

/** 최근 N일 페이지별 성과 */
export async function queryTopPages(days = 28, rowLimit = 25): Promise<SearchConsoleResult> {
  const { startDate, endDate } = lastNDaysRange(days);
  return querySearchConsole({ startDate, endDate, dimensions: ["page"], rowLimit });
}

/** 최근 N일 일자별 추이 (클릭·노출 트렌드 그래프용) */
export async function queryDailyTrend(days = 28): Promise<SearchConsoleResult> {
  const { startDate, endDate } = lastNDaysRange(days);
  return querySearchConsole({ startDate, endDate, dimensions: ["date"], rowLimit: days });
}

/** Search Console 데이터는 보통 2~3일 지연되므로 종료일을 오늘이 아니라 3일 전으로 잡는다 */
function lastNDaysRange(days: number): { startDate: string; endDate: string } {
  const end = new Date();
  end.setDate(end.getDate() - 3);
  const start = new Date(end);
  start.setDate(start.getDate() - days);

  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { startDate: fmt(start), endDate: fmt(end) };
}
