"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/admin/settings", label: "개요·오픈 준비" },
  { href: "/admin/settings/operation", label: "운영 기본" },
  { href: "/admin/settings/spaces", label: "공간" },
  { href: "/admin/settings/closures", label: "휴관일" },
  { href: "/admin/settings/blocks", label: "일정 차단" },
  { href: "/admin/settings/booking-windows", label: "교육실 접수기간" },
  { href: "/admin/settings/application", label: "신청 규칙" },
  { href: "/admin/settings/fees", label: "요금표" },
  { href: "/admin/settings/discounts", label: "감면" },
  { href: "/admin/settings/payment", label: "결제·환불" },
  { href: "/admin/settings/notification", label: "알림" },
  { href: "/admin/settings/privacy", label: "개인정보" },
  { href: "/admin/settings/content", label: "안내·규정 문구" },
  { href: "/admin/settings/integrations", label: "연동 상태" },
];

export function SettingsNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="설정 메뉴" className="mb-6 overflow-x-auto border-b border-line lg:mb-0 lg:w-44 lg:shrink-0 lg:border-b-0">
      <ul className="flex gap-1 whitespace-nowrap pb-2 lg:flex-col lg:pb-0">
        {items.map((item) => {
          const active = item.href === "/admin/settings" ? pathname === item.href : pathname.startsWith(item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`block rounded px-3 py-1.5 text-sm ${active ? "bg-navy text-white" : "text-ink hover:bg-cream"}`}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
