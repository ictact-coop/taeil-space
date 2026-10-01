import Link from "next/link";

export function PageHeader({
  title,
  description,
  crumbs = [],
}: {
  title: string;
  description?: string;
  crumbs?: { href: string; label: string }[];
}) {
  return (
    <header className="mb-6">
      {crumbs.length > 0 && (
        <nav aria-label="위치" className="mb-2 text-sm text-muted">
          {crumbs.map((c) => (
            <span key={c.href}>
              <Link href={c.href} className="underline">
                {c.label}
              </Link>{" "}
              /{" "}
            </span>
          ))}
          <span>{title}</span>
        </nav>
      )}
      <h1 className="text-2xl font-bold text-navy">{title}</h1>
      {description && <p className="mt-1 text-sm text-muted">{description}</p>}
    </header>
  );
}

export function Notice({ kind, children }: { kind: "success" | "error" | "warning" | "info"; children: React.ReactNode }) {
  const styles = {
    success: "border-status-green/30 bg-status-green/5 text-status-green",
    error: "border-danger/30 bg-danger/5 text-danger",
    warning: "border-warning/30 bg-warning/5 text-warning",
    info: "border-navy/20 bg-navy/5 text-navy",
  }[kind];
  return (
    <div role={kind === "error" ? "alert" : "status"} className={`rounded border px-3 py-2 text-sm ${styles}`}>
      {children}
    </div>
  );
}

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-lg border border-line bg-white p-5 ${className}`}>{children}</section>;
}

export function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="text-xs text-danger">
      {message}
    </p>
  );
}

/** 검색 파라미터로 전달된 처리 결과 메시지 */
export function ResultNotice({ done, error }: { done?: string; error?: string }) {
  if (!done && !error) return null;
  return <div className="mb-4">{error ? <Notice kind="error">{error}</Notice> : <Notice kind="success">{done}</Notice>}</div>;
}

export function ReadOnlyNotice() {
  return (
    <div className="mb-4">
      <Notice kind="info">이 화면은 조회만 할 수 있습니다. 수정 권한이 없습니다.</Notice>
    </div>
  );
}
