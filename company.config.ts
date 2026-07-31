// ============================================================
//  나의 AI 회사 설정 — 여기 한 파일만 고치면 됩니다
// ============================================================
//  회사 이름, 부서 이름, 직원 이름·성격·머리색까지 전부 여기 있어요.
//  다른 파일은 건드리지 않아도 됩니다.
//
//  ⚠️ 딱 2가지 규칙
//   1. 부서 id(research, brand, ...)는 절대 바꾸지 마세요. 시뮬레이션 엔진이
//      이 id로 움직입니다. 바꾸면 캐릭터가 길을 잃어요.
//      → 바꿔도 되는 건 name(부서 이름) · icon · short 입니다.
//   2. 부서는 12개를 유지하세요. 사무실 배치가 4열 3행 = 12칸 고정입니다.
//      안 쓰는 부서는 지우지 말고 이름만 바꿔서 쓰세요.
//
//  직원 수는 자유롭게 늘리고 줄여도 됩니다. 한 팀에 팀장(lead) 1명은 두세요.
// ============================================================

/** 회사 기본 정보 */
export const COMPANY = {
  /** 좌측 상단 헤더에 뜨는 회사 이름 */
  name: "MAILLARD",
  /** 헤더 로고 배지에 들어갈 글자 1개 (이모지도 됩니다) */
  logoLetter: "🥩",
  /** 화면 상단 큰 제목 (앞부분) */
  titlePrefix: "나의",
  /** 화면 상단 큰 제목 (강조되는 뒷부분) */
  titleAccent: "마이야르 오피스",
  /** 브라우저 탭 제목 */
  pageTitle: "마이야르 — 요리 레시피 AI 오피스",
  /** 검색·공유될 때 뜨는 설명 */
  description: "12개 AI 팀이 조사·기획·제작·보고까지 돌아가는 요리 레시피 SEO 콘텐츠 플랫폼 AI 오피스",
  /** 창 하단 파일명 느낌의 라벨 */
  windowLabel: "maillard.exe — 대표실",
  /** 일일 브리핑 제목에 들어갈 이름 */
  reportName: "마이야르",
} as const;

/** 대표(나) — 사무실 대표실에 앉아 있는 캐릭터 */
export const CEO_PROFILE = {
  name: "에이쎕",
  callsign: "대표님",
  role: "대표 · 최종 의사결정",
  hair: "#42283a",
  shirt: "#ff8fc0",
  accent: "#fff3b0",
  skin: "#ffdcc4",
  thoughts: [
    "AI는 비서, 최종 결정은 내가 해요.",
    "오늘 결정할 건 딱 1개만 남기자.",
    "검색 1페이지에 올라갈 콘텐츠인지부터 본다.",
  ],
};

/**
 * 부서 12개.
 * id = 고정(엔진용) / name·short·icon = 자유롭게 변경
 * task = 오늘 하는 일 / report = 팀장 한줄보고
 */
export const DEPARTMENTS = [
  {
    id: "research",
    name: "레시피 리서치팀",
    short: "recipe.lab",
    icon: "🔎",
    task: "인기 검색어·트렌드 요리 수집",
    report: "검색량과 경쟁 강도를 확인하고 오늘의 후보를 정리해요.",
    tomorrow: "내일은 계절 재료 기준으로 후보군을 새로 잡고, 최근 30일 검색 트렌드를 다시 훑어요.",
    improve: "출처 확인에 시간이 오래 걸리는 편이라, 신뢰 가능한 출처 리스트를 미리 정리해두면 속도가 빨라져요.",
  },
  {
    id: "brand",
    name: "SEO 분석팀",
    short: "seo.room",
    icon: "📊",
    task: "검색순위·유입 키워드 점검",
    report: "지표 연동이 되면 순위 변동까지 붙습니다.",
    tomorrow: "검색콘솔 연동이 끝나면 바로 순위·유입 키워드 리포트를 시작해요. 연동 전까지는 콘텐츠별 예상 키워드 목록만 미리 정리해둘게요.",
    improve: "지표 없이 추정치를 만들지 않는 원칙은 유지하되, 수동으로 확인 가능한 자료로 임시 참고 자료를 보완할 수 있어요.",
  },
  {
    id: "strategy1",
    name: "키워드 기획팀",
    short: "keyword.studio",
    icon: "💡",
    task: "오늘의 롱테일 키워드 10개",
    report: "검색량·난이도 기준으로 TOP 3까지 좁혀요.",
    tomorrow: "오늘 통과한 후보 중 상위권을 다시 검증하고, 새 롱테일 키워드 10개를 추가로 뽑아요.",
    improve: "채점 기준에 '실제 조리 난이도'를 더 반영해서, 검색은 되는데 너무 어려운 레시피는 미리 걸러낼게요.",
  },
  {
    id: "qa",
    name: "레시피 검수팀",
    short: "qa.kitchen",
    icon: "🛡️",
    task: "계량·조리순서·중복 검사",
    report: "계량이 틀리거나 근거 없는 원고는 되돌려보내요.",
    tomorrow: "오늘 반려 건 중 근거 부족 건은 리서치팀 재조사 후 재검수하고, 통과 건은 원고팀 인계를 준비해요.",
    improve: "반려 사유를 체크리스트로 만들어 리서치·기획 단계에서 미리 걸러지도록 공유할게요.",
  },
  {
    id: "strategy2",
    name: "원고 작성팀",
    short: "recipe.write",
    icon: "✍️",
    task: "승인된 키워드로 레시피 원고 작성",
    report: "대표가 고른 키워드만 글로 옮겨요.",
    tomorrow: "승인된 TOP1 콘텐츠 원고를 확정하고, 차순위 후보 원고도 미리 초안까지 만들어둘게요.",
    improve: "도입부 후킹 문장을 몇 가지 더 실험해서 초반 이탈률을 줄여볼게요.",
  },
  {
    id: "reels",
    name: "조리 영상팀",
    short: "video.cook",
    icon: "🎬",
    task: "조리 과정 영상 촬영·편집",
    report: "원본은 보존하고 편집본만 새로 만들어요.",
    tomorrow: "원고 확정본을 기준으로 촬영 콘티를 짜고, 하이라이트 편집본 작업을 시작해요.",
    improve: "컷 템포가 늘어지는 구간이 있었는데, 평균 컷 길이를 더 짧게 맞춰볼게요.",
  },
  {
    id: "carousel",
    name: "푸드 이미지팀",
    short: "food.studio",
    icon: "🍳",
    task: "완성 사진·단계컷·썸네일 제작",
    report: "필요한 장수만 만들고 대표 이미지로 닫아요.",
    tomorrow: "확정 원고를 기준으로 단계별 컷과 대표 이미지 3안을 제작해요.",
    improve: "썸네일에 조리시간이 빠지는 실수가 종종 있어서, 발행 전 체크리스트에 필수 항목으로 추가할게요.",
  },
  {
    id: "partner",
    name: "제휴·광고팀",
    short: "partner.mail",
    icon: "💌",
    task: "애드센스·협업 문의 검토",
    report: "초안까지만 씁니다. 발송은 대표가 해요.",
    tomorrow: "메일 연동이 되면 바로 대기 중인 제휴 문의를 확인하고 답장 초안을 준비해요. 연동 전까지는 문의 유형을 정리해둘게요.",
    improve: "자주 오는 문의 유형별 답변 템플릿을 미리 만들어두면 연동 즉시 처리 속도가 빨라져요.",
  },
  {
    id: "finance",
    name: "광고수익팀",
    short: "adsense.xls",
    icon: "🧾",
    task: "애드센스 수익·정산 현황 정리",
    report: "현황 파일이 오면 바로 정리합니다.",
    tomorrow: "재무 파일을 받으면 그날 안에 정산 현황을 정리해서 보고할게요.",
    improve: "파일 포맷을 미리 정해두면(예: 월별 CSV) 정리 시간을 더 줄일 수 있어요.",
  },
  {
    id: "review",
    name: "트래픽 리뷰팀",
    short: "traffic.data",
    icon: "📈",
    task: "방문자·체류시간·이탈률 기록",
    report: "잘된 이유를 패턴으로 남겨요.",
    tomorrow: "오늘 발행한 콘텐츠의 초기 반응을 지켜보고, 잘된 패턴·안 된 패턴을 정리해서 기획팀에 넘겨요.",
    improve: "체류시간 데이터를 좀 더 세분화해서 어느 구간에서 이탈하는지 짚어볼게요.",
  },
  {
    id: "ops",
    name: "자동화 운영팀",
    short: "automation.ops",
    icon: "⚙️",
    task: "배포·색인·재시도 관리",
    report: "실패하면 재시도하고 로그를 남겨요.",
    tomorrow: "오늘 배포·색인 로그를 점검하고, 실패 건이 있으면 재시도 스케줄을 다시 잡아요.",
    improve: "재시도 알림을 더 빨리 받을 수 있도록 모니터링 주기를 줄여볼게요.",
  },
  {
    id: "secretary",
    name: "비서실",
    short: "secretary.hq",
    icon: "📋",
    task: "전사 한줄보고·최종 브리핑",
    report: "모든 팀 상태를 모아 결정할 것만 남겨드려요.",
    tomorrow: "오늘 리스크로 남은 항목들을 다시 체크해서 연동되는 대로 바로 보고할게요.",
    improve: "브리핑에서 중복 설명을 더 줄이고, 결정할 것만 상단에 올리도록 정리할게요.",
  },
] as const;

/**
 * 직원 명단.
 * dept = 위 부서 id / rank: "lead"(팀장) 또는 "member"(팀원)
 * colors = [머리색, 옷색, 포인트색]
 * thoughts = 자리를 비웠을 때 머리 위에 뜨는 혼잣말
 */
export type StaffEntry = {
  dept: string;
  rank: "lead" | "member";
  name: string;
  role: string;
  colors: [string, string, string];
  thoughts: string[];
  callsign?: string;
};

export const STAFF_LIST: StaffEntry[] = [
  // ① 레시피 리서치팀
  { dept: "research", rank: "lead", name: "김서연", role: "레시피 리서치 팀장", callsign: "김리서",
    colors: ["#6b3d34", "#fff3b0", "#ff8fc0"],
    thoughts: ["이 레시피, 실제로 검색량이 있나 확인해야 해.", "제철 재료 기준으로 다시 골라보자.", "원문 조리법부터 다시 본다."] },
  { dept: "research", rank: "member", name: "오태윤", role: "트렌드 요리 리서처",
    colors: ["#2f2a3d", "#c9b8ff", "#b8f0dd"],
    thoughts: ["신규 레시피인데 검색량 0이면 대상 아님.", "국내에서 구하기 힘든 재료는 후보에서 빼자."] },
  { dept: "research", rank: "member", name: "하은채", role: "검색어 동향 조사",
    colors: ["#8a4a3c", "#b8f0dd", "#ff8fc0"],
    thoughts: ["이번 주 사람들이 뭘 검색했지?", "재탕 레시피는 원문으로 안 쳐요."] },

  // ② SEO 분석팀
  { dept: "brand", rank: "lead", name: "박보라", role: "SEO 분석 팀장", callsign: "박브리",
    colors: ["#372b4a", "#c9b8ff", "#c9b8ff"],
    thoughts: ["지표 연동 전엔 순위를 지어내지 않아요.", "우리 사이트 톤에서 벗어난 제목인지 본다."] },
  { dept: "brand", rank: "member", name: "신재원", role: "검색순위 분석",
    colors: ["#3c3a4f", "#ffe6f2", "#c9b8ff"],
    thoughts: ["체류시간이 클릭수보다 중요해요.", "30일 순위 흐름부터 그려보자."] },
  { dept: "brand", rank: "member", name: "임다혜", role: "타이틀·메타 검증",
    colors: ["#5a3450", "#fff3b0", "#ff8fc0"],
    thoughts: ["우리가 안 쓰기로 한 제목 패턴이에요.", "타겟 키워드가 흐려지면 다시 잡아요."] },

  // ③ 키워드 기획팀
  { dept: "strategy1", rank: "lead", name: "최아름", role: "키워드 기획 팀장", callsign: "최아이",
    colors: ["#c26e4b", "#ff8fc0", "#fff3b0"],
    thoughts: ["오늘도 정확히 10개, 예외 없어요.", "검색량부터 채우고 시작.", "경쟁 키워드가 겹치면 롱테일로 바꾼다."] },
  { dept: "strategy1", rank: "member", name: "정유진", role: "롱테일 키워드 발굴",
    colors: ["#7b4a2f", "#b8f0dd", "#ff8fc0"],
    thoughts: ["제목을 좀 더 구체적으로 바꿔볼까.", "'몇 분' '몇 도' 같은 숫자가 빠졌다."] },
  { dept: "strategy1", rank: "member", name: "배시현", role: "검색의도 분석",
    colors: ["#2c2638", "#fff3b0", "#c9b8ff"],
    thoughts: ["상위 3초 안에 답이 안 보이면 다시 써요.", "레시피는 결론부터, 사족 금지."] },

  // ④ 레시피 검수팀
  { dept: "qa", rank: "lead", name: "윤규아", role: "레시피 검수 팀장", callsign: "윤큐아",
    colors: ["#2d4b46", "#b8f0dd", "#b8f0dd"],
    thoughts: ["계량 단위 통일 스캔 돌립니다.", "화력·시간 표시 없는 원고는 반려예요."] },
  { dept: "qa", rank: "member", name: "강태오", role: "중복·계량 검사",
    colors: ["#463227", "#ffe6f2", "#b8f0dd"],
    thoughts: ["최근 레시피랑 40% 겹쳤네.", "실제로 만들어본 근거가 있는지 확인."] },
  { dept: "qa", rank: "member", name: "문세라", role: "조리순서 검수",
    colors: ["#6c3a55", "#c9b8ff", "#fff3b0"],
    thoughts: ["과장된 '초간단' 표현은 바로 빼요.", "우리 사이트 톤 유지하는지 본다."] },

  // ⑤ 원고 작성팀
  { dept: "strategy2", rank: "lead", name: "한도빈", role: "원고 팀장", callsign: "한대본",
    colors: ["#8b534a", "#fff3b0", "#ff8fc0"],
    thoughts: ["승인된 키워드만 원고로 씁니다.", "레시피는 재료-순서-팁 구조로 닫아야 해요."] },
  { dept: "strategy2", rank: "member", name: "조민서", role: "본문 원고",
    colors: ["#33304a", "#ff8fc0", "#b8f0dd"],
    thoughts: ["재료 목록부터 잡고 들어간다.", "조리 단계는 5단계 안에 끝나야 해요."] },
  { dept: "strategy2", rank: "member", name: "백가온", role: "FAQ·팁 작성",
    colors: ["#5d3a2c", "#b8f0dd", "#c9b8ff"],
    thoughts: ["실패하는 이유를 FAQ로 다시 정리합니다.", "마지막엔 보관법으로 닫아요."] },

  // ⑥ 조리 영상팀
  { dept: "reels", rank: "lead", name: "송리원", role: "조리 영상 팀장", callsign: "송릴스",
    colors: ["#2c2638", "#ff8fc0", "#ff8fc0"],
    thoughts: ["원본 촬영본은 절대 안 건드려요.", "불필요한 대기 컷부터 치고 시작."] },
  { dept: "reels", rank: "member", name: "권지호", role: "영상 편집",
    colors: ["#4a3a2a", "#fff3b0", "#b8f0dd"],
    thoughts: ["컷 템포가 늘어지면 이탈이에요.", "굽는 소리는 대표가 직접 넣어요."] },
  { dept: "reels", rank: "member", name: "유세아", role: "자막·썸네일",
    colors: ["#7a3f58", "#c9b8ff", "#ff8fc0"],
    thoughts: ["썸네일 5종 뽑아둘게요.", "워터마크는 안 넣습니다."] },

  // ⑦ 푸드 이미지팀
  { dept: "carousel", rank: "lead", name: "이가림", role: "푸드 이미지 팀장", callsign: "이캐리",
    colors: ["#d88d68", "#c9b8ff", "#c9b8ff"],
    thoughts: ["원본 사진은 보정만, 합성 금지.", "필요한 단계컷만 뽑아요."] },
  { dept: "carousel", rank: "member", name: "남주하", role: "단계별 컷 정리",
    colors: ["#3a2f4d", "#ffe6f2", "#ff8fc0"],
    thoughts: ["단계별 사진 밀도 맞추는 중.", "대표 이미지 3안부터 만들자."] },
  { dept: "carousel", rank: "member", name: "표하늘", role: "썸네일 텍스트",
    colors: ["#274a44", "#fff3b0", "#b8f0dd"],
    thoughts: ["대표 이미지에 조리시간 빠지면 반려예요.", "보정본에만 손댑니다."] },

  // ⑧ 제휴·광고팀
  { dept: "partner", rank: "lead", name: "정파랑", role: "제휴 팀장", callsign: "정파트",
    colors: ["#563a32", "#b8f0dd", "#b8f0dd"],
    thoughts: ["메일 연동 전이라 아직 못 읽어요.", "실제 발송은 대표 손으로."] },
  { dept: "partner", rank: "member", name: "구예성", role: "협업 검토",
    colors: ["#452d3f", "#c9b8ff", "#fff3b0"],
    thoughts: ["결이 맞는 식품·주방용품 제안만 받습니다.", "답장 초안까지만 준비해둘게요."] },

  // ⑨ 광고수익팀
  { dept: "finance", rank: "lead", name: "오재민", role: "광고수익 팀장", callsign: "오재무",
    colors: ["#313b56", "#fff3b0", "#fff3b0"],
    thoughts: ["애드센스 현황 파일이 오면 바로 정리합니다.", "입금 대기 건부터 확인해요."] },
  { dept: "finance", rank: "member", name: "심우진", role: "정산 관리",
    colors: ["#4b3b2c", "#b8f0dd", "#c9b8ff"],
    thoughts: ["지연된 건은 따로 표시해둡니다.", "결제는 자동으로 안 해요."] },

  // ⑩ 트래픽 리뷰팀
  { dept: "review", rank: "lead", name: "강성아", role: "트래픽 리뷰 팀장", callsign: "강성과",
    colors: ["#9c5c72", "#ff8fc0", "#ff8fc0"],
    thoughts: ["잘된 이유를 패턴으로 남겨야 해요.", "체류시간·재방문이 진짜 지표입니다."] },
  { dept: "review", rank: "member", name: "마지훈", role: "방문자 지표 수집",
    colors: ["#2e3a4a", "#ffe6f2", "#b8f0dd"],
    thoughts: ["유입·이탈률 다시 긁어옵니다.", "연동되면 자동화돼요."] },
  { dept: "review", rank: "member", name: "여름", role: "학습점 정리",
    colors: ["#6b4a2f", "#c9b8ff", "#fff3b0"],
    thoughts: ["반복할 패턴 1개, 중단할 패턴 1개.", "다음 기획팀에 넘길 학습점 정리 중."] },

  // ⑪ 자동화 운영팀
  { dept: "ops", rank: "lead", name: "안도현", role: "자동화 운영 팀장", callsign: "안오토",
    colors: ["#3b3b49", "#b8f0dd", "#b8f0dd"],
    thoughts: ["오전 배포 스케줄 정상입니다.", "실패하면 재시도하고 로그 남겨요."] },
  { dept: "ops", rank: "member", name: "천유나", role: "색인·연동 모니터링",
    colors: ["#573049", "#fff3b0", "#ff8fc0"],
    thoughts: ["연결 안 된 서비스를 성공으로 안 씁니다.", "검색엔진 색인 대기 중이에요."] },

  // ⑫ 비서실
  { dept: "secretary", rank: "lead", name: "김세리", role: "비서실장", callsign: "김비서",
    colors: ["#7a453c", "#c9b8ff", "#c9b8ff"],
    thoughts: ["대표가 결정할 것만 추립니다.", "중복 설명은 다 지워요."] },
  { dept: "secretary", rank: "member", name: "홍보람", role: "브리핑 정리",
    colors: ["#334a3a", "#ffe6f2", "#fff3b0"],
    thoughts: ["상태별로 묶어서 올릴게요.", "막힌 건 먼저 보고해요."] },
];

/**
 * 외부 연동을 아직 안 붙인 팀 → 화면에 "연동 대기"로 표시됩니다.
 * 연동을 다 붙였거나, 그냥 전부 초록불로 보고 싶으면 빈 배열 []로 두세요.
 */
export const PENDING_INTEGRATIONS: Record<string, string> = {
  brand: "검색콘솔 지표 연동",
  partner: "메일 연동",
  finance: "애드센스 현황 파일",
};

/**
 * 결과 보관함 링크 (Notion 등). 비워두면 화면에서 링크 버튼이 숨겨집니다.
 * 예: "https://www.notion.so/내페이지주소"
 */
export const STORAGE_LINK = "";
