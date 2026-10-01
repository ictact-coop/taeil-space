/**
 * 메일 발송 확인. 운영 SMTP 설정으로 실제 메일 한 통을 보낸다.
 *   docker compose ... run --rm web pnpm mail:test --to staff@taeil.org
 * 스팸함에 들어가면 발신 도메인의 SPF·DKIM 설정을 확인한다.
 */
import { parseArgs } from "node:util";
import { sendEmail } from "../src/server/notifications/mailer";

const { values } = parseArgs({ options: { to: { type: "string" } } });
if (!values.to || !/^[^@\s]+@[^@\s]+$/.test(values.to)) {
  console.error("사용법: pnpm mail:test --to 받는주소@example.org");
  process.exit(1);
}
try {
  await sendEmail({
    to: values.to,
    subject: "[전태일기념관] 대관 시스템 메일 발송 확인",
    text: `대관 시스템에서 보낸 확인 메일입니다.\n\n발송 방식: ${process.env.EMAIL_PROVIDER ?? "log"}\n주소: ${process.env.APP_BASE_URL ?? "-"}\n보낸 시각: ${new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}\n\n받은편지함에 들어왔다면 정상입니다. 스팸함에 있으면 발신 도메인의 SPF·DKIM 설정을 확인하세요.`,
  });
  console.log(`보냈습니다: ${values.to} (EMAIL_PROVIDER=${process.env.EMAIL_PROVIDER ?? "log"})`);
} catch (e) {
  console.error(`발송 실패: ${e instanceof Error ? e.message : e}`);
  process.exitCode = 1;
}
