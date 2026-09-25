import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "대시보드" };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const { denied } = await searchParams;
  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="mb-6 text-2xl font-bold text-navy">대시보드</h1>
      {denied && (
        <p role="alert" className="mb-4 rounded border border-warning/30 bg-warning/5 px-3 py-2 text-sm text-warning">
          이 메뉴를 볼 권한이 없습니다.
        </p>
      )}
      <section className="rounded-lg border border-line bg-white p-6">
        <h2 className="mb-2 font-semibold">준비 중</h2>
        <p className="text-sm text-muted">
          신규 신청·결제·취소요청 현황은 신청 기능(단계 2·3)과 함께 이곳에 표시됩니다. 지금은{" "}
          <Link href="/admin/settings" className="text-brick underline">
            정책 설정
          </Link>
          에서 운영 규칙을 입력할 수 있습니다.
        </p>
      </section>
    </div>
  );
}
