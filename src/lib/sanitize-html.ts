/**
 * 관리자가 정책 설정에 넣는 짧은 HTML(첫 페이지 안내 상자 등)을 화면에 넣기 전에 거른다.
 * 허용 목록 방식: 아래 태그와 class·href 속성만 남기고 나머지는 모두 버린다(글자는 남김).
 * script·style 등은 내용까지 지운다. href는 http(s)·mailto·tel·사이트 안 주소만.
 */
const ALLOWED_TAGS = new Set(["p", "br", "strong", "b", "em", "i", "u", "span", "h1", "h2", "h3", "ul", "ol", "li", "a", "small"]);
const VOID_TAGS = new Set(["br"]);
const DROP_WITH_CONTENT = /<(script|style|iframe|object|embed|template|noscript|textarea|svg|math)\b[\s\S]*?<\/\1\s*>/gi;

const escapeAttr = (v: string) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeText = (v: string) => v.replace(/</g, "&lt;").replace(/>/g, "&gt;");

function safeHref(raw: string): string | null {
  // 엔티티·공백·제어문자로 javascript: 를 숨기는 경우를 막기 위해 정규화한 값으로 판정한다
  const decoded = raw
    .replace(/&#x([0-9a-f]+);?/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (_, d: string) => String.fromCharCode(Number(d)))
    .replace(/&colon;/gi, ":")
    .replace(/[\u0000- \u007f]+/g, "")
    .trim();
  if (/^(https?:|mailto:|tel:)/i.test(decoded)) return decoded;
  if (/^[/#](?![/\\])/.test(decoded)) return decoded;
  return null;
}

function filterAttrs(tag: string, attrs: string): string {
  const out: string[] = [];
  for (const m of attrs.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    const name = m[1]!.toLowerCase();
    const value = m[2] ?? m[3] ?? m[4] ?? "";
    if (name === "class" && /^[\w\s\-:[\]/#.%]*$/.test(value)) out.push(`class="${escapeAttr(value)}"`);
    if (name === "href" && tag === "a") {
      const href = safeHref(value);
      if (href) out.push(`href="${escapeAttr(href)}"`);
    }
  }
  if (tag === "a" && out.some((a) => a.startsWith('href="http'))) out.push('rel="noopener noreferrer"');
  return out.length ? " " + out.join(" ") : "";
}

export function sanitizeHtml(input: string): string {
  const html = input.replace(/<!--[\s\S]*?-->/g, "").replace(DROP_WITH_CONTENT, "");
  let result = "";
  let last = 0;
  for (const m of html.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g)) {
    result += escapeText(html.slice(last, m.index));
    last = m.index! + m[0].length;
    const closing = m[1] === "/";
    const tag = m[2]!.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) continue;
    if (closing) {
      if (!VOID_TAGS.has(tag)) result += `</${tag}>`;
    } else {
      result += `<${tag}${filterAttrs(tag, m[3] ?? "")}>`;
    }
  }
  result += escapeText(html.slice(last));
  return result;
}
