import Link from "next/link";
import { hasPermission } from "@/domain/auth/permissions";
import { requireAdmin } from "@/server/auth/current";
import { logoutAction } from "./actions";
import { NavLink } from "./nav-link";

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin();
  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <aside className="flex flex-col bg-navy px-4 py-5 text-white md:w-56 md:shrink-0">
        <div className="mb-6 px-3">
          <p className="text-xs text-white/60">전태일기념관</p>
          <p className="font-serif text-lg">대관관리</p>
        </div>
        <nav aria-label="관리자 메뉴" className="flex flex-row flex-wrap gap-1 md:flex-col">
          <NavLink href="/admin">대시보드</NavLink>
          {hasPermission(admin, "applications.view") && <NavLink href="/admin/applications">신청 관리</NavLink>}
          {hasPermission(admin, "calendar.view") && <NavLink href="/admin/calendar">대관 캘린더</NavLink>}
          {hasPermission(admin, "refunds.manage") && <NavLink href="/admin/refunds">환불 처리</NavLink>}
          {hasPermission(admin, "settings.view") && <NavLink href="/admin/settings">정책 설정</NavLink>}
          {hasPermission(admin, "accounts.manage") && <NavLink href="/admin/accounts">계정 관리</NavLink>}
          {admin.isSuper && <NavLink href="/admin/grades">등급 관리</NavLink>}
          {hasPermission(admin, "audit.view") && <NavLink href="/admin/audit">감사 로그</NavLink>}
        </nav>
        <div className="mt-6 border-t border-white/15 px-3 pt-4 text-sm md:mt-auto">
          <p className="font-medium">{admin.name}</p>
          <p className="text-xs text-white/60">{admin.gradeName}</p>
          <Link href="/admin/account" className="mt-2 inline-block text-xs text-white/75 underline hover:text-white">
            내 계정
          </Link>
          <form action={logoutAction} className="mt-3">
            <button type="submit" className="text-xs text-white/75 underline hover:text-white">
              로그아웃
            </button>
          </form>
        </div>
      </aside>
      <main className="flex-1 bg-[#fbf9f4] px-4 py-6 sm:px-8">{children}</main>
    </div>
  );
}
