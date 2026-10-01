/**
 * 이메일 발송 ([요구] 23장). EMAIL_PROVIDER:
 * - smtp: SMTP 서버로 발송. AWS SES·NHN Cloud 등 SMTP 지원 서비스에 쓸 수 있다. 두 가지 방식 중 하나로 설정한다.
 *     SMTP_HOST·SMTP_PORT·SMTP_USER·SMTP_PASS (권장: 비밀번호에 + / 같은 문자가 있어도 그대로 넣으면 된다)
 *     SMTP_URL (예: smtps://user:pass@host:465 — 사용자명·비밀번호의 특수문자는 URL 인코딩해야 한다)
 * - log(기본): 실제로 보내지 않고 서버 로그에 남긴다(개발용).
 * - memory: 테스트용. 보낸 메일을 배열에 모은다.
 */
export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
}

export const memoryOutbox: OutgoingEmail[] = [];

export interface SmtpOptions {
  host: string;
  port: number;
  /** 465는 처음부터 TLS(SMTPS), 587·25는 STARTTLS */
  secure: boolean;
  auth?: { user: string; pass: string };
}

/** 환경변수에서 SMTP 설정을 만든다. SMTP_URL이 있으면 그것을, 없으면 SMTP_HOST 등을 쓴다. 설정이 없으면 null. */
export function smtpConfigFromEnv(env: Record<string, string | undefined> = process.env): string | SmtpOptions | null {
  const url = env.SMTP_URL?.trim();
  if (url) return url;
  const host = env.SMTP_HOST?.trim();
  if (!host) return null;
  const port = Number(env.SMTP_PORT?.trim() || 465);
  const user = env.SMTP_USER?.trim();
  return { host, port, secure: port === 465, ...(user ? { auth: { user, pass: env.SMTP_PASS ?? "" } } : {}) };
}

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
  const config = smtpConfigFromEnv();
  const from = process.env.EMAIL_FROM;
  if (!config || !from) throw new Error("SMTP_HOST(또는 SMTP_URL)와 EMAIL_FROM을 설정하세요.");
  if (!transporter) {
    const nodemailer = await import("nodemailer");
    // 메일 서버가 응답하지 않을 때 대기열 발송이 오래 멈추지 않게 한다(실패하면 다음 차례에 재시도)
    const timeouts = { connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 30_000 };
    transporter = nodemailer.createTransport(typeof config === "string" ? { url: config, ...timeouts } : { ...config, ...timeouts });
  }
  await transporter.sendMail({ from, to: mail.to, subject: mail.subject, text: mail.text });
}
