export function AuthShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-cream px-4 py-12">
      <div className="w-full max-w-sm rounded-lg border border-line bg-white p-8 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-full bg-brick text-sm font-bold text-white" aria-hidden>
            ㅈㅌ
          </span>
          <div>
            <p className="text-xs text-muted">전태일기념관 대관관리</p>
            <h1 className="text-lg font-bold text-navy">{title}</h1>
          </div>
        </div>
        {children}
      </div>
    </main>
  );
}

export function FormError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
      {message}
    </p>
  );
}
