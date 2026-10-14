"use client";

import Image from "next/image";
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
          <Image src="/images/logo.png" alt="아름다운청년 전태일 · 전태일기념관" width={455} height={384} priority unoptimized className="h-14 w-auto sm:h-16" />
          <span className="hidden border-l border-line pl-3 text-sm font-semibold text-navy sm:block">전태일기념관 대관 신청 페이지</span>
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
