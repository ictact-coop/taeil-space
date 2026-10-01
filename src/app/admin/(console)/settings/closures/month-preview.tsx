import { addDays, evaluateClosure, weekdayOf, type ClosureRule } from "@/domain/calendar/closures";

/** 한 달 달력에 휴관일을 표시한다(색과 문자를 함께 사용, NFR-02). */
export function MonthPreview({
  year,
  month,
  spaceId,
  rules,
  today,
}: {
  year: number;
  month: number;
  spaceId: string | null;
  rules: ClosureRule[];
  today: string;
}) {
  const first = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells: (string | null)[] = Array.from({ length: weekdayOf(first) }, () => null);
  for (let d = 0; d < lastDay; d += 1) cells.push(addDays(first, d));

  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-navy">
        {year}년 {month}월
      </h3>
      <div role="grid" className="grid grid-cols-7 gap-1 text-center text-xs">
        {["일", "월", "화", "수", "목", "금", "토"].map((w) => (
          <div key={w} role="columnheader" className="py-1 text-muted">
            {w}
          </div>
        ))}
        {cells.map((date, i) => {
          if (!date) return <div key={`e${i}`} />;
          const r = evaluateClosure(date, spaceId, rules);
          const day = Number(date.slice(8));
          const title = r.closed ? `${date} 휴관: ${r.rule.name}` : r.openedBy ? `${date} 예외 개관: ${r.openedBy.name}` : `${date} 운영`;
          return (
            <div
              key={date}
              role="gridcell"
              title={title}
              aria-label={title}
              className={`rounded px-1 py-1.5 ${
                r.closed ? "bg-danger/10 text-danger" : r.openedBy ? "bg-status-green/10 text-status-green" : "bg-cream/60"
              } ${date === today ? "ring-2 ring-navy" : ""}`}
            >
              <span className="block font-medium">{day}</span>
              <span className="block text-[10px] leading-tight">{r.closed ? "휴관" : r.openedBy ? "개관" : " "}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
