# 🥩 마이야르 AI 오피스 — 깃허브 페이지로 배포하는 버전

이 폴더는 **클라우드플레어 없이, 깃허브만으로** 24시간 켜지는 웹사이트를
만들 수 있게 따로 준비한 버전이에요. (학교·PC방처럼 클라우드플레어가 막혀 있어도 됩니다!)

> ⚠️ 이 버전은 화면 시뮬레이션만 됩니다. Notion·Discord로 실제 보고서를 보내는
> 기능은 서버가 있어야 해서, 이 버전에서는 빠져 있어요. (버튼을 눌러도 "미지원"으로만 표시돼요)

---

## 🖥️ 내 컴퓨터에서 미리 보기

```bash
npm install
npm run dev
```

브라우저에서 나오는 주소(보통 http://localhost:5173)를 열면 확인할 수 있어요.

---

## 🌍 깃허브 페이지로 실제 배포하기 (하나씩 그대로 따라 하세요)

### 1) 깃허브에 새 창고 만들기

1. github.com 로그인 → 오른쪽 위 **＋** → **New repository**
2. 이름을 **정확히** `maillard-ai-office` 라고 입력 (다른 이름 쓰면 2단계에서 설명하는 걸 꼭 바꿔야 해요)
3. **Create repository** 클릭

### 2) (이름을 다르게 만들었다면) 설정 파일 한 줄 고치기

저장소 이름을 `maillard-ai-office`가 아닌 다른 이름으로 만들었다면,
`vite.config.ts` 파일을 열어서 이 부분을:

```ts
base: "/maillard-ai-office/",
```

내가 만든 저장소 이름으로 바꿔주세요. 예를 들어 저장소 이름이 `my-shop` 이라면:

```ts
base: "/my-shop/",
```

**저장소 이름을 그대로 `maillard-ai-office`로 만들었다면 이 단계는 건너뛰세요.**

### 3) 컴퓨터 파일을 깃허브로 올리기

이 폴더(지금 열려 있는 폴더)에서 터미널을 열고, 아래를 한 줄씩 복사해서 붙여넣고 엔터⏎:

```bash
git init
```
```bash
git add .
```
```bash
git commit -m "마이야르 AI 오피스 첫 업로드"
```
```bash
git branch -M main
```

그다음 깃허브 저장소 페이지에서 초록색 **Code** 버튼을 눌러 주소를 복사하고,
아래 명령어의 `내아이디` 부분만 내 진짜 아이디로 바꿔서 실행하세요:

```bash
git remote add origin https://github.com/내아이디/maillard-ai-office.git
```
```bash
git push -u origin main
```

### 4) 깃허브에서 "Pages 기능" 켜기 (딱 한 번만 하면 돼요)

1. 깃허브 저장소 페이지 → 위쪽 메뉴 **Settings** 클릭
2. 왼쪽 메뉴 맨 아래쪽 **Pages** 클릭
3. **Build and deployment** 항목에서 **Source**를 **GitHub Actions** 로 선택

이게 끝이에요! 별도 열쇠(토큰)도 필요 없습니다.

### 5) 자동 배포 확인하기

1. 저장소 페이지 위쪽 **Actions** 탭 클릭
2. 목록에 진행 중인 게 보여요. 초록 체크 ✅ 뜨면 성공!
3. 다시 **Settings → Pages** 로 가면 화면 위쪽에
   **"Your site is live at https://내아이디.github.io/maillard-ai-office/"** 라고 뜹니다.
4. 그 주소를 클릭하면 **내 진짜 웹사이트**가 열려요 🎉

---

## ✏️ 내 회사로 바꾸기

`company.config.ts` 파일 하나만 고치면 돼요. (지금은 이미 "마이야르"로 세팅돼 있어요)
고친 뒤에는 다시 저장하고:

```bash
git add .
git commit -m "회사 정보 수정"
git push
```

이렇게 push만 하면 몇 분 뒤 자동으로 사이트에 반영됩니다.

---

## 🙋 자주 막히는 곳

**Actions에서 빨간 X가 떠요**
`npm ci`나 빌드 단계에서 에러 메시지를 클릭해서 확인하세요. 대부분
`vite.config.ts`의 `base` 값이 저장소 이름과 다를 때 생겨요.

**사이트는 열리는데 화면이 하얗게 비어요**
`base` 값이 저장소 이름과 정확히 일치하는지 확인하세요. (앞뒤 `/` 포함해서 똑같아야 해요)

**Notion·Discord 연동 버튼이 안 돼요**
정상입니다. 이 정적 사이트 버전에서는 원래 지원하지 않아요.
실제 연동까지 쓰고 싶으면 클라우드플레어를 쓸 수 있는 곳에서
원래 버전(`ai-office` 폴더)으로 배포하세요.

---

이 툴은 **갓생맘 🎀** 이 만들었어요.
📷 [@godseng.mom](https://www.instagram.com/godseng.mom/) — 더 많은 크리에이터 툴 보러가기
