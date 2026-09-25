import { SiteHeader } from "@/components/public/site-header";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-[#fbf9f4]">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2">
        본문으로 건너뛰기
      </a>
      <SiteHeader />
      <main id="main" className="flex-1">
        {children}
      </main>
      <footer className="border-t border-line bg-white">
        <div className="mx-auto max-w-6xl px-4 py-6 text-xs text-muted sm:px-6">
          전태일기념관 · 서울특별시 종로구 청계천로 105 · 대관 문의 02-318-0903~4
        </div>
      </footer>
    </div>
  );
}
