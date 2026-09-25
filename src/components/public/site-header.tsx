"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const nav = [
  { href: "/", label: "대관 안내" },
  { href: "/spaces", label: "공간 안내" },
  { href: "/apply", label: "대관 신청" },
  { href: "/my", label: "나의 대관" },
];

export function SiteHeader() {
  const pathname = usePathname();
  return (
    <header className="border-b border-line bg-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-full bg-brick text-sm font-bold text-white" aria-hidden>
            ㅈㅌ
          </span>
          <span>
            <span className="block font-serif text-lg leading-tight text-navy">전태일기념관</span>
            <span className="block text-[10px] tracking-[0.15em] text-muted">JEON TAE IL MEMORIAL HALL</span>
          </span>
        </Link>
        <nav aria-label="주 메뉴">
          <ul className="flex gap-1 text-sm font-semibold sm:gap-4">
            {nav.map((item) => {
              const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`block border-b-2 px-2 py-2 ${active ? "border-brick text-navy" : "border-transparent text-ink hover:text-navy"}`}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </header>
  );
}
