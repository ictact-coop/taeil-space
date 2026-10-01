"use client";

import { useEffect, useState } from "react";

/** 결제 유효시간 남은 시간 (화면 표시용. 실제 만료는 서버가 판단한다) */
export function Countdown({ until }: { until: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);
  if (now === null) return null;
  const left = Math.max(0, new Date(until).getTime() - now);
  if (left === 0) return <span className="text-danger">기한이 지났습니다</span>;
  const h = Math.floor(left / 3_600_000);
  const m = Math.floor((left % 3_600_000) / 60_000);
  const s = Math.floor((left % 60_000) / 1000);
  return (
    <span aria-live="off">
      {h > 0 ? `${h}시간 ` : ""}
      {m}분 {String(s).padStart(2, "0")}초 남음
    </span>
  );
}
