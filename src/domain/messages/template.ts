/**
 * 관리자가 고치는 안내 문구의 자리표시자 채우기와 문구 모음 읽기.
 * 자리표시자: {일자} {공간} {신청번호} {단체명} {담당자}
 */
export type TemplateVars = Partial<Record<"일자" | "공간" | "신청번호" | "단체명" | "담당자", string>>;

export const TEMPLATE_PLACEHOLDERS = ["일자", "공간", "신청번호", "단체명", "담당자"] as const;

/** 알 수 없는 자리표시자나 값이 없는 자리표시자는 그대로 둔다(오타를 눈치채도록) */
export function fillTemplate(text: string, vars: TemplateVars): string {
  return text.replace(/\{(일자|공간|신청번호|단체명|담당자)\}/g, (m, key: keyof TemplateVars) => vars[key] ?? m);
}

export interface MessageTemplate {
  title: string;
  body: string;
}

/**
 * 문구 모음: `---`만 있는 줄로 문구를 나누고, 각 문구의 첫 줄은 목록에 보일 이름이다.
 * 예) "일정 중복\n안녕하세요...\n---\n신청 기한\n본 시설은..."
 */
export function parseMessageTemplates(text: string): MessageTemplate[] {
  return text
    .split(/^[ \t]*-{3,}[ \t]*$/m)
    .map((block) => block.replace(/^\s*\n/, "").replace(/\s+$/, ""))
    .filter((block) => block.trim() !== "")
    .map((block) => {
      const [first, ...rest] = block.split("\n");
      return { title: (first ?? "").trim(), body: rest.join("\n").trim() };
    })
    .filter((t) => t.title !== "" && t.body !== "");
}

/** 승인 안내 문구의 첫 줄을 메일 제목으로 쓴다(나머지는 본문) */
export function splitSubject(text: string): { subject: string; body: string } {
  const lines = text.trim().split("\n");
  return { subject: (lines[0] ?? "").trim(), body: lines.slice(1).join("\n").trim() };
}
