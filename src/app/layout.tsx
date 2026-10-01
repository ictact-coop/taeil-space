import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "전태일기념관 대관", template: "%s | 전태일기념관 대관" },
  description: "전태일기념관 공간 대관 신청·관리 시스템",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
