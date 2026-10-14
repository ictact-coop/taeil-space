import { describe, expect, it } from "vitest";
import { sanitizeHtml } from "./sanitize-html";

describe("관리자 HTML 거르기", () => {
  it("허용한 태그와 class는 남긴다", () => {
    expect(sanitizeHtml('<h1 class="font-serif text-4xl">모임의 뜻이<br /><span class="text-brick-dark">이어지는 공간</span></h1>')).toBe(
      '<h1 class="font-serif text-4xl">모임의 뜻이<br><span class="text-brick-dark">이어지는 공간</span></h1>',
    );
    expect(sanitizeHtml('<p>안내 <a href="/apply">신청</a> · <a href="https://taeil.org">홈</a></p>')).toBe(
      '<p>안내 <a href="/apply">신청</a> · <a href="https://taeil.org" rel="noopener noreferrer">홈</a></p>',
    );
  });

  it("스크립트·이벤트 속성·위험한 주소는 버린다", () => {
    expect(sanitizeHtml("<p>가<script>alert(1)</script>나</p>")).toBe("<p>가나</p>");
    expect(sanitizeHtml('<img src=x onerror="alert(1)">글')).toBe("글");
    expect(sanitizeHtml('<p onclick="alert(1)" style="color:red" class="a">x</p>')).toBe('<p class="a">x</p>');
    expect(sanitizeHtml('<a href="javascript:alert(1)">x</a>')).toBe("<a>x</a>");
    expect(sanitizeHtml('<a href="jav&#x61;script:alert(1)">x</a>')).toBe("<a>x</a>");
    expect(sanitizeHtml('<a href=" java\tscript:alert(1)">x</a>')).toBe("<a>x</a>");
    expect(sanitizeHtml('<a href="//evil.example">x</a>')).toBe("<a>x</a>");
    expect(sanitizeHtml('<span class="x" onmouseover=alert(1)>y</span>')).toBe('<span class="x">y</span>');
    expect(sanitizeHtml('<p class="a&quot; onclick=&quot;x">t</p>')).toBe("<p>t</p>");
    expect(sanitizeHtml("<style>body{}</style><iframe src=x></iframe>ok")).toBe("ok");
    expect(sanitizeHtml("<svg><script>alert(1)</script></svg>a")).toBe("a");
    expect(sanitizeHtml("1 < 2 > 0")).toBe("1 &lt; 2 &gt; 0");
  });
});
