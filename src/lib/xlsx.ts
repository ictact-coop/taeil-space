import XlsxPopulate from "xlsx-populate";

export type Cell = string | number | null | undefined;

/** 내려받기 파일 비밀번호 규칙(엑셀을 열 때 입력) */
export const MIN_EXPORT_PASSWORD = 6;
export function validateExportPassword(password: string, confirm: string): string | null {
  if (password.length < MIN_EXPORT_PASSWORD) return `비밀번호는 ${MIN_EXPORT_PASSWORD}자 이상으로 정하세요.`;
  if (password.length > 100) return "비밀번호는 100자 이하로 정하세요.";
  if (password !== confirm) return "비밀번호 확인이 일치하지 않습니다.";
  return null;
}

/**
 * 표(첫 행 = 머리글)를 비밀번호로 암호화한 엑셀(xlsx) 파일로 만든다. 엑셀에서 열 때 비밀번호를 물어본다.
 * 값은 모두 문자열·숫자로만 넣는다(수식으로 해석되지 않게 =로 시작하는 값도 문자열 그대로).
 */
export async function encryptedXlsx(rows: readonly (readonly Cell[])[], opts: { sheetName: string; password: string }): Promise<Buffer> {
  const wb = await XlsxPopulate.fromBlankAsync();
  const sheet = wb.sheet(0).name(opts.sheetName.slice(0, 31));
  const width = Math.max(1, ...rows.map((r) => r.length));
  const values = rows.map((r) => Array.from({ length: width }, (_, i) => normalize(r[i])));
  if (values.length > 0) {
    sheet.range(1, 1, values.length, width).value(values);
    sheet.range(1, 1, 1, width).style("bold", true);
    sheet.freezePanes(0, 1);
  }
  for (let c = 1; c <= width; c++) {
    const longest = Math.max(...values.map((r) => String(r[c - 1] ?? "").length));
    sheet.column(c).width(Math.min(60, Math.max(8, longest * 1.6 + 2)));
  }
  return wb.outputAsync({ password: opts.password });
}

function normalize(v: Cell): string | number | null {
  if (v === undefined || v === null || v === "") return null;
  return typeof v === "number" ? v : String(v);
}

/** 엑셀 내려받기 응답 헤더(한글 파일 이름) */
export function xlsxHeaders(filename: string): HeadersInit {
  return {
    "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "content-disposition": `attachment; filename="export.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    "cache-control": "no-store",
  };
}
