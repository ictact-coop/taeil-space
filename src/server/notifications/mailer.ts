/**
 * 이메일 발송 ([요구] 23장). EMAIL_PROVIDER:
 * - smtp: SMTP_URL(예: smtps://user:pass@email-smtp.ap-northeast-2.amazonaws.com:465)로 발송. AWS SES·NHN Cloud 등 SMTP 지원 서비스에 쓸 수 있다.
 * - log(기본): 실제로 보내지 않고 서버 로그에 남긴다(개발용).
 * - memory: 테스트용. 보낸 메일을 배열에 모은다.
 */
export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
}

export const memoryOutbox: OutgoingEmail[] = [];

let transporter: { sendMail(opts: Record<string, unknown>): Promise<unknown> } | null = null;

export async function sendEmail(mail: OutgoingEmail): Promise<void> {
  const provider = process.env.EMAIL_PROVIDER ?? "log";
  if (provider === "memory") {
    memoryOutbox.push(mail);
    return;
  }
  if (provider === "log") {
    console.log(`[email:log] to=${mail.to} subject=${mail.subject}\n${mail.text}`);
    return;
  }
  if (provider !== "smtp") throw new Error(`지원하지 않는 EMAIL_PROVIDER: ${provider}`);
  const url = process.env.SMTP_URL;
  const from = process.env.EMAIL_FROM;
  if (!url || !from) throw new Error("SMTP_URL과 EMAIL_FROM을 설정하세요.");
  if (!transporter) {
    const nodemailer = await import("nodemailer");
    transporter = nodemailer.createTransport(url);
  }
  await transporter.sendMail({ from, to: mail.to, subject: mail.subject, text: mail.text });
}
