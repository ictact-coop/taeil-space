/**
 * 확장자와 실제 파일 내용(앞부분 시그니처)이 맞는지 확인한다.
 * 확장자만 바꾼 실행 파일 등을 막기 위한 것이다.
 */
const PDF = [0x25, 0x50, 0x44, 0x46]; // %PDF
const PNG = [0x89, 0x50, 0x4e, 0x47];
const JPG = [0xff, 0xd8, 0xff];
const ZIP = [0x50, 0x4b, 0x03, 0x04]; // docx, xlsx, pptx, hwpx
const OLE = [0xd0, 0xcf, 0x11, 0xe0]; // hwp, doc, xls
const WEBP_RIFF = [0x52, 0x49, 0x46, 0x46];

const signatures: Record<string, { magic: number[][]; contentType: string }> = {
  pdf: { magic: [PDF], contentType: "application/pdf" },
  png: { magic: [PNG], contentType: "image/png" },
  jpg: { magic: [JPG], contentType: "image/jpeg" },
  jpeg: { magic: [JPG], contentType: "image/jpeg" },
  webp: { magic: [WEBP_RIFF], contentType: "image/webp" },
  docx: { magic: [ZIP], contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  xlsx: { magic: [ZIP], contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  pptx: { magic: [ZIP], contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation" },
  hwpx: { magic: [ZIP], contentType: "application/hwp+zip" },
  hwp: { magic: [OLE], contentType: "application/x-hwp" },
  doc: { magic: [OLE], contentType: "application/msword" },
  xls: { magic: [OLE], contentType: "application/vnd.ms-excel" },
};

export function extensionOf(fileName: string): string {
  const m = /\.([a-z0-9]{1,10})$/i.exec(fileName);
  return m ? m[1]!.toLowerCase() : "";
}

export function detectContentType(ext: string, head: Uint8Array): string | null {
  const sig = signatures[ext];
  if (!sig) return null;
  const matches = sig.magic.some((magic) => magic.every((byte, i) => head[i] === byte));
  if (!matches) return null;
  if (ext === "webp" && String.fromCharCode(...head.slice(8, 12)) !== "WEBP") return null;
  return sig.contentType;
}

export function isSupportedExtension(ext: string): boolean {
  return Object.hasOwn(signatures, ext);
}
