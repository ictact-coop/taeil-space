import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "나의 대관" };

export default function MyPage() {
  return (
    <div className="mx-auto max-w-xl px-4 py-16 text-center">
      <h1 className="font-serif text-2xl text-navy">나의 대관</h1>
      <p className="mt-3 text-sm text-muted">
        휴대전화·이메일 본인 확인으로 신청 내역을 조회하는 기능을 준비하고 있습니다. 신청 직후에는 신청한 브라우저에서 결제 화면을 다시 열 수 있습니다.
      </p>
      <Link href="/apply" className="btn-primary mt-6">
        대관 신청하기
      </Link>
    </div>
  );
}
