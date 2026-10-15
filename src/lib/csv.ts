/** 엑셀에서 바로 열 수 있는 CSV(UTF-8 BOM, CRLF). 수식으로 해석될 수 있는 값(= + - @ 시작)은 앞에 '를 붙인다. */
export function toCsv(rows: readonly (readonly (string | number | null | undefined)[])[]): string {
  const cell = (v: string | number | null | undefined) => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "string" && /^[=+\-@\t\r]/.test(v) ? `'${v}` : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return `﻿${rows.map((r) => r.map(cell).join(",")).join("\r\n")}\r\n`;
}

/** 내려받기 응답 헤더(한글 파일 이름) */
export function csvHeaders(filename: string): HeadersInit {
  return {
    "content-type": "text/csv; charset=utf-8",
    "content-disposition": `attachment; filename="export.csv"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    "cache-control": "no-store",
  };
}
