import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    environment: "node",
    // DB 통합 테스트가 같은 테스트 DB를 쓰므로 파일 단위로 순차 실행
    fileParallelism: false,
  },
});
