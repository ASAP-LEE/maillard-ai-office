// ============================================================
//  NVIDIA NIM 호출 경로 설정 — Vercel 프록시 연결
// ============================================================
//  이 사이트(GitHub Pages)는 정적 사이트라 서버가 없어서, 브라우저가 NVIDIA API를
//  직접 호출하면 CORS 정책 때문에 "Failed to fetch"가 납니다.
//  그래서 Vercel에 아주 얇은 중계 함수(/api/nvidia-proxy.js)를 하나 배포하고,
//  이 파일에서 그 주소를 알려주기만 합니다.
//
//  ⚠️ 아래 PROXY_BASE_URL을 Vercel 배포 후 나오는 내 주소로 반드시 바꿔주세요.
//     예: "https://maillard-ai-office-proxy.vercel.app"
//     (끝에 / 는 붙이지 마세요)
//
//  설정 순서:
//   1) vercel.com 가입(GitHub 계정으로 로그인)
//   2) 이 저장소(maillard-ai-office)를 Vercel에 Import
//   3) 배포되면 나오는 주소(https://xxxx.vercel.app)를 아래에 붙여넣기
//   4) 저장 → git push 하면 GitHub Pages 사이트에도 반영됩니다
// ============================================================

const PROXY_BASE_URL = "https://maillard-ai-office-git-main-asap9.vercel.app"; // ⚠️ Vercel 배포 주소

export const CHAT_COMPLETIONS_URL = `${PROXY_BASE_URL}/api/nvidia-proxy`;

export function isProxyConfigured(): boolean {
  return PROXY_BASE_URL.trim().length > 0;
}

export function proxyNotConfiguredError(): Error {
  return new Error(
    "AI 호출 경로가 아직 설정되지 않았어요. src/game/aiProxy.ts 파일의 PROXY_BASE_URL에 " +
      "Vercel 배포 주소를 넣고 다시 배포해주세요. (자세한 방법은 README의 'Vercel 프록시 설정' 참고)",
  );
}

/** fetch 자체가 실패했을 때(네트워크 차단, 프록시 주소 오류 등) 보여줄 안내 메시지 */
export function explainFetchFailure(): Error {
  return new Error(
    "AI 서버 호출에 실패했어요 (Failed to fetch).\n" +
      "가능한 원인:\n" +
      "1) aiProxy.ts의 PROXY_BASE_URL이 비어 있거나 잘못된 주소예요.\n" +
      "2) Vercel 프록시가 아직 배포되지 않았거나 슬립 상태예요 (다시 시도해보세요).\n" +
      "3) 네트워크 연결이 없어요.",
  );
}
