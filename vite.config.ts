import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// ============================================================
//  GitHub Pages 배포 설정
// ============================================================
//  이 사이트는 GitHub Pages에서만 화면을 보여줍니다.
//  (Vercel은 화면을 안 띄우고 API 프록시 함수(/api/nvidia-proxy)만 제공해요.
//   자세한 내용은 README의 'Vercel 프록시 설정' 참고)
//
//  깃허브 저장소 이름이 "maillard-ai-office" 라면 base는 그대로 두세요.
//  저장소 이름을 바꿨다면 아래 base 값도 "/저장소이름/" 으로 똑같이 바꿔주세요.
//  (예: 저장소 이름이 "my-repo" 라면 base: "/my-repo/")
// ============================================================
export default defineConfig({
  base: "/maillard-ai-office/",
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "dist",
  },
});
