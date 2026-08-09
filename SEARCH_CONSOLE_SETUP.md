# 🔗 Search Console 실제 연동 설정 가이드

이 문서는 **SEO 분석팀(`brand`)이 "연동 대기"에서 "정상 업무"로 바뀌기까지**
대표님이 직접 하셔야 하는 5단계를 순서대로 안내합니다.

코드는 이미 다 준비되어 있어요. 아래 단계를 따라 **키를 발급하고, 권한을 주고,
Vercel에 등록**하기만 하면 자동으로 연동됩니다. 연동되기 전까지 SEO 분석팀은
지금처럼 정직하게 "연동 대기"로 표시되고, 절대 가짜 숫자를 보여주지 않아요.

---

## 전체 그림

```
브라우저(GitHub Pages, 정적 사이트)
   │  (프록시 토큰만 들고 요청)
   ▼
Vercel 서버리스 함수 (api/search-console.js)
   │  (서비스 계정 비밀 키로 Google에 인증 — 이 키는 여기에만 있음)
   ▼
Google Search Console API
```

브라우저는 절대 Google 비밀 키를 들고 있지 않습니다. 정적 사이트(GitHub Pages)는
개발자 도구로 누구나 코드를 볼 수 있기 때문에, 비밀 키는 반드시 서버(Vercel)에만
둬야 안전합니다.

---

## 1단계 — Google Cloud에서 서비스 계정 만들기

1. [Google Cloud Console](https://console.cloud.google.com/)에 로그인합니다. 로그인 계정은
   **본인이 관리하는 구글 계정이면 무엇이든** 괜찮습니다 (Search Console 속성 소유자와
   같을 필요는 없어요, 3단계에서 권한만 나중에 주면 됩니다).
2. 상단의 프로젝트 선택 드롭다운 → **새 프로젝트** → 이름은 자유롭게(예: `maillard-seo`) →
   **만들기**.
3. 왼쪽 메뉴 **API 및 서비스 → 라이브러리**로 이동 → `Google Search Console API` 검색 →
   **사용 설정** 클릭.
4. 왼쪽 메뉴 **IAM 및 관리자 → 서비스 계정** → **서비스 계정 만들기**.
   - 이름: 예) `maillard-seo-reader`
   - 나머지 단계는 기본값으로 두고 **완료**.
5. 방금 만든 서비스 계정을 목록에서 클릭 → **키** 탭 → **키 추가 → 새 키 만들기** →
   **JSON** 선택 → **만들기**.
   → JSON 파일이 자동으로 다운로드됩니다. **이 파일이 통째로 비밀 키입니다.**
   깃허브에 올리거나 남에게 공유하지 마세요.

JSON 파일을 열어보면 이런 값들이 있어요. 4단계에서 이 중 2개를 씁니다:

```json
{
  "client_email": "maillard-seo-reader@내프로젝트.iam.gserviceaccount.com",
  "private_key": "-----BEGIN PRIVATE KEY-----\n....\n-----END PRIVATE KEY-----\n"
}
```

---

## 2단계 — Search Console에 서비스 계정 사용자로 추가하기

서비스 계정은 "계정"이긴 하지만 로그인은 못 하는 로봇 계정이라, 내 Search Console
속성에 **사용자로 초대**해줘야 지표를 읽을 수 있습니다.

1. [Google Search Console](https://search.google.com/search-console)에 접속해서
   연동하려는 속성(내 웹사이트)을 선택합니다.
2. 왼쪽 메뉴 **설정 → 사용자 및 권한** → **사용자 추가**.
3. 이메일 주소란에 1단계에서 복사한 `client_email` 값을 그대로 붙여넣습니다.
   (예: `maillard-seo-reader@내프로젝트.iam.gserviceaccount.com`)
4. 권한은 **전체(소유자)**까지 줄 필요 없이 **읽기 전용(제한됨)**이면 충분합니다 —
   이 프로젝트는 지표를 조회만 하고 아무것도 바꾸지 않아요.
5. **추가** 클릭.

> ⚠️ 속성 주소도 메모해두세요 (다음 단계에서 필요). 두 가지 형태가 있을 수 있어요:
> - URL 접두어 속성: `https://example.com/`
> - 도메인 속성: `sc-domain:example.com`
>
> Search Console 왼쪽 상단 속성 선택 드롭다운에서 정확한 형태를 확인할 수 있어요.

---

## 3단계 — Vercel에 배포하고 환경변수 등록하기

이미 `api/nvidia-proxy.js`를 Vercel에 배포하셨다면, **같은 프로젝트**에
`api/search-console.js`도 함께 배포됩니다 (같은 저장소이므로 자동으로 인식됩니다).
아직 Vercel 배포를 안 하셨다면:

1. [vercel.com](https://vercel.com)에 GitHub 계정으로 로그인.
2. **Add New → Project** → 이 저장소(`maillard-ai-office`) 선택 → **Import**.
3. Framework Preset은 그대로 두고(정적 배포로 이미 `vercel.json`에 설정되어 있음) **Deploy**.

배포가 끝났다면(또는 이미 되어 있다면) 환경변수를 등록합니다:

1. Vercel 프로젝트 → **Settings → Environment Variables**로 이동합니다.
2. 아래 5개를 하나씩 추가합니다 (모두 **Production**, 필요하면 **Preview**에도 체크):

   | Key | Value | 비고 |
   |---|---|---|
   | `GSC_CLIENT_EMAIL` | JSON의 `client_email` 값 | 그대로 복사 |
   | `GSC_PRIVATE_KEY` | JSON의 `private_key` 값 | 줄바꿈 포함해서 그대로 붙여넣기 (Vercel이 여러 줄 입력을 지원합니다) |
   | `GSC_SITE_URL` | 2단계에서 확인한 속성 주소 | 예: `https://example.com/` 또는 `sc-domain:example.com` |
   | `GSC_PROXY_TOKEN` | 아무 임의의 긴 문자열 | 직접 만드세요 (예: 비밀번호 생성기로 32자 이상). 아래 4단계에서 프론트엔드에도 **똑같이** 넣어야 합니다 |
   | `GSC_ALLOWED_ORIGIN` | 내 GitHub Pages 주소 | 예: `https://내아이디.github.io` (끝에 `/` 없이). 처음엔 비워둬도(`*`) 되지만, 정상 동작 확인 후 좁히는 걸 권장합니다 |

3. 저장 후, Vercel 프로젝트 → **Deployments** 탭에서 최신 배포 옆 **⋯ → Redeploy**를
   눌러 환경변수를 반영합니다. (환경변수는 재배포해야 함수에 적용됩니다.)

---

## 4단계 — 프론트엔드 코드에 두 값 채우기

저장소에서 `src/game/searchConsoleProxy.ts` 파일을 엽니다:

```ts
const PROXY_BASE_URL = "https://maillard-ai-office.vercel.app"; // ⚠️ Vercel 배포 주소
const PROXY_ACCESS_TOKEN = ""; // ⚠️ 여기를 채우세요
```

- `PROXY_BASE_URL`: 이미 NVIDIA 프록시용으로 채워놓으셨다면 그대로 두면 됩니다
  (같은 Vercel 배포 주소를 씁니다).
- `PROXY_ACCESS_TOKEN`: 3단계에서 Vercel에 등록한 `GSC_PROXY_TOKEN`과
  **정확히 똑같은 값**을 넣습니다.

저장 후 커밋 & 푸시하면 GitHub Pages 사이트에도 반영됩니다:

```bash
git add .
git commit -m "Search Console 연동 설정"
git push
```

---

## 5단계 — 연결 테스트

1. 배포된 GitHub Pages 사이트를 새로고침해서 엽니다.
2. **대시보드** 화면으로 이동합니다.
3. 왼쪽 **🔗 integrations.link** 패널에서 "Search Console (SEO 분석팀)" 항목이
   `연동됨`(초록색)으로 바뀌었는지 확인합니다.
   - `확인 중…` → 아직 로딩 중이니 몇 초 기다려보세요.
   - `연동 대기` 또는 `미설정` → 아래 "문제 해결"을 참고하세요.
4. 정상 연동됐다면 같은 화면에 **📊 seo.room · Search Console** 패널이 새로 생기고,
   실제 클릭수·노출수·CTR·평균순위와 검색어별 데이터가 표시됩니다.
5. 라이브 오피스 화면(사무실 시뮬레이션)에서도 SEO 분석팀(박보라 팀장)이 더 이상
   라운지로 가지 않고, "Search Console 연동 확인! 실제 지표로 분석 시작할게요"라고
   말하는지 확인해보세요.

---

## 문제 해결

| 증상 | 원인 | 해결 |
|---|---|---|
| `연동 대기`가 계속 보임, 이유가 "프록시 주소 또는 접근 토큰이 설정되지 않았어요" | 4단계를 안 했거나 값이 비어있음 | `searchConsoleProxy.ts`의 두 값을 채우고 재배포 |
| 이유가 "Google 인증 실패: invalid_grant" 등 | `GSC_PRIVATE_KEY`가 잘못 복사됨(줄바꿈 깨짐) | JSON 파일에서 `private_key` 값을 다시 통째로 복사해서 Vercel에 재입력 |
| 이유가 "Search Console API 오류: ... 403" | 서비스 계정이 아직 GSC 속성에 사용자로 추가되지 않음 | 2단계를 다시 확인 — `client_email`을 정확히 추가했는지 |
| 이유가 "인증되지 않은 요청입니다" | `PROXY_ACCESS_TOKEN`과 `GSC_PROXY_TOKEN`이 서로 다름 | 두 값이 정확히 같은지 다시 확인 |
| 데이터는 뜨는데 전부 0 | 정상일 수 있음 | Search Console 데이터는 통상 2~3일 지연됩니다. 새 사이트라면 아직 색인/트래픽이 없을 수도 있어요 |
| `configuration_error`가 뜸 (missing 목록 포함) | Vercel 환경변수 중 일부가 비어있음 | 응답의 `missing` 배열에 나온 환경변수를 Vercel에 채우고 재배포 |

---

## 이후 확장 (참고)

`src/game/searchConsole.ts`는 검색어·페이지·기간별 원시 데이터(`items`)까지 그대로
반환하도록 만들어져 있어서, 나중에 AI가 이 데이터를 읽고 키워드 전략을 제안하는
기능(예: `agentPipeline.ts`에 SEO 분석 단계 추가)으로 자연스럽게 확장할 수 있습니다.
지금 당장 구현된 범위는 "실제 지표 조회 + 대시보드 표시"까지입니다.
