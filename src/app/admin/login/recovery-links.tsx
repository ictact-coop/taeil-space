import Link from "next/link";

export function RecoveryLinks({ current }: { current?: "login" | "find-id" | "reset" }) {
  const links = [
    { key: "login", href: "/admin/login", label: "로그인" },
    { key: "find-id", href: "/admin/login/find-id", label: "아이디 찾기" },
    { key: "reset", href: "/admin/login/reset", label: "비밀번호 재설정" },
  ].filter((l) => l.key !== current);
  return (
    <p className="mt-6 flex justify-center gap-3 text-xs text-muted">
      {links.map((l, i) => (
        <span key={l.key} className="flex gap-3">
          {i > 0 && <span aria-hidden>·</span>}
          <Link href={l.href} className="underline">
            {l.label}
          </Link>
        </span>
      ))}
    </p>
  );
}
