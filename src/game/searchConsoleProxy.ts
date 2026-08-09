// ============================================================
//  Google Search Console 호출 경로 설정 — Vercel 프록시 연결
// ============================================================
//  이 사이트(GitHub Pages)는 정적 사이트라 서버가 없어서, 브라우저가 Google API를
//  직접 호출할 수 없습니다 (서비스 계정 비밀 키를 브라우저에 둘 수 없기 때문 — 개발자
//  도구로 누구나 볼 수 있어요). 그래서 Vercel에 얇은 중계 함수(/api/search-console)를
//  하나 배포하고, 이 파일에서 그 주소를 알려주기만 합니다.
//
//  aiProxy.ts(NVIDIA)와 다른 점: NVIDIA 프록시는 "브라우저가 들고 온 키"를 그대로
//  전달만 하지만, 이 프록시는 서버 자신이 Google 서비스 계정 키를 들고 인증합니다.
//  그래서 이 프록시를 아무나 호출하면 내 검색 데이터가 새어나갈 수 있어, 프론트엔드도
//  자체 토큰(PROXY_ACCESS_TOKEN)을 같이 보내서 한 번 더 잠급니다.
//
//  ⚠️ 아래 두 값을 채워주세요:
//   1) PROXY_BASE_URL — Vercel 배포 주소 (nvidia-proxy와 같은 배포를 그대로 씁니다)
//   2) PROXY_ACCESS_TOKEN — Vercel 환경변수 GSC_PROXY_TOKEN과 "똑같은" 값
//      (브라우저 코드에 들어가는 값이라 완전히 비밀은 아니지만, 이 프록시 주소를
//       모르는 사람은 어차피 못 씁니다. 최소한의 오남용 방지 장치입니다.)
//
//  설정 순서는 README의 "Search Console 연동 설정" 문서를 참고하세요.
// ============================================================

const PROXY_BASE_URL = "https://maillard-ai-office.vercel.app"; // ⚠️ Vercel 배포 주소 (nvidia-proxy와 동일 배포)
const PROXY_ACCESS_TOKEN = ""; // ⚠️ Vercel의 GSC_PROXY_TOKEN과 동일한 값을 넣어주세요

export const SEARCH_CONSOLE_URL = `${PROXY_BASE_URL}/api/search-console`;

export function isSearchConsoleProxyConfigured(): boolean {
  return PROXY_BASE_URL.trim().length > 0 && PROXY_ACCESS_TOKEN.trim().length > 0;
}

export function searchConsoleAuthHeader(): string {
  return `Bearer ${PROXY_ACCESS_TOKEN}`;
}

export function proxyNotConfiguredError(): Error {
  return new Error(
    "Search Console 호출 경로가 아직 설정되지 않았어요. src/game/searchConsoleProxy.ts 파일의 " +
      "PROXY_BASE_URL과 PROXY_ACCESS_TOKEN을 채워주세요. (자세한 방법은 SEARCH_CONSOLE_SETUP.md 참고)",
  );
}

/** fetch 자체가 실패했을 때(네트워크 차단, 프록시 주소 오류 등) 보여줄 안내 메시지 */
export function explainFetchFailure(): Error {
  return new Error(
    "Search Console 서버 호출에 실패했어요 (Failed to fetch).\n" +
      "가능한 원인:\n" +
      "1) searchConsoleProxy.ts의 PROXY_BASE_URL이 비어 있거나 잘못된 주소예요.\n" +
      "2) Vercel 함수가 아직 배포되지 않았거나 슬립 상태예요 (다시 시도해보세요).\n" +
      "3) 네트워크 연결이 없어요.",
  );
}
