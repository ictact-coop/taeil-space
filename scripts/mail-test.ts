/**
 * 메일 발송 확인. 운영 SMTP 설정으로 실제 메일 한 통을 보낸다.
 *   docker compose ... run --rm web pnpm mail:test --to staff@taeil.org
 *   docker compose ... run --rm web pnpm mail:test --to staff@taeil.org --space hall
 * --space를 주면 그 공간의 승인 안내 문구(관리 > 공간)를 예시 신청 내용으로 채워 승인 메일 모양 그대로 보낸다.
 * 스팸함에 들어가면 발신 도메인의 SPF·DKIM 설정을 확인한다.
 */
import { parseArgs } from "node:util";
import { eq } from "drizzle-orm";
import { createDb } from "../src/server/db/connect";
import { spaces } from "../src/server/db/schema";
import { sendEmail } from "../src/server/notifications/mailer";
import { appBaseUrl, templateVars } from "../src/server/notifications/queue";
import { applicantMessage } from "../src/server/notifications/templates";
import { fillTemplate } from "../src/domain/messages/template";

const { values } = parseArgs({ options: { to: { type: "string" }, space: { type: "string" } } });
if (!values.to || !/^[^@\s]+@[^@\s]+$/.test(values.to)) {
  console.error("사용법: pnpm mail:test --to 받는주소@example.org [--space 공간코드]");
  process.exit(1);
}

async function sampleApproval(code: string): Promise<{ subject: string; text: string }> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL이 필요합니다.");
  const { db, pool } = createDb(url);
  try {
    const [space] = await db.select().from(spaces).where(eq(spaces.code, code));
    if (!space) throw new Error(`공간 코드 '${code}'가 없습니다.`);
    // 다음 주 같은 요일 10:00–12:00 예시
    const start = new Date(Date.now() + 7 * 86_400_000);
    start.setUTCHours(1, 0, 0, 0);
    const app = { applicationNo: "R000000-00000", orgName: "(예시) ○○단체", contactName: "(예시) 홍길동", startsAt: start, endsAt: new Date(start.getTime() + 2 * 3_600_000) };
    const msg = applicantMessage("approved", {
      ...app,
      spaceName: space.name,
      when: "",
      total: 0,
      myUrl: `${appBaseUrl()}/my`,
      reviewPeriod: "",
      approvalNotice: space.approvalNotice.trim() ? fillTemplate(space.approvalNotice, templateVars(app, space.name)) : null,
    });
    return { subject: `[시험] ${msg.subject}`, text: `※ 메일 발송 확인용 예시입니다(신청번호·단체·일시는 가짜).\n\n${msg.body}` };
  } finally {
    await pool.end();
  }
}

try {
  const mail = values.space
    ? await sampleApproval(values.space)
    : {
        subject: "[전태일기념관] 대관 시스템 메일 발송 확인",
        text: `대관 시스템에서 보낸 확인 메일입니다.\n\n발송 방식: ${process.env.EMAIL_PROVIDER ?? "log"}\n주소: ${process.env.APP_BASE_URL ?? "-"}\n보낸 시각: ${new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}\n\n받은편지함에 들어왔다면 정상입니다. 스팸함에 있으면 발신 도메인의 SPF·DKIM 설정을 확인하세요.`,
      };
  await sendEmail({ to: values.to, subject: mail.subject, text: mail.text });
  console.log(`보냈습니다: ${values.to} (EMAIL_PROVIDER=${process.env.EMAIL_PROVIDER ?? "log"})${values.space ? ` · ${values.space} 승인 안내` : ""}`);
} catch (e) {
  console.error(`발송 실패: ${e instanceof Error ? e.message : e}`);
  process.exitCode = 1;
}
