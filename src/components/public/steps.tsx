/** 신청 4단계 표시 (계획서 1.3: 신청 → 결제 → 심사·확정). 계좌이체로 받을 때는 payLabel을 "입금"으로 준다. */
export function Steps({ current, payLabel = "결제" }: { current: 1 | 2 | 3 | 4; payLabel?: string }) {
  const steps = ["공간·일정 선택", "신청정보 입력", payLabel, "관리자 심사·확정"];
  return (
    <ol className="flex flex-wrap items-center gap-2 text-xs sm:gap-4 sm:text-sm" aria-label="신청 단계">
      {steps.map((label, i) => {
        const n = i + 1;
        const state = n < current ? "done" : n === current ? "current" : "todo";
        return (
          <li key={label} className="flex items-center gap-2" aria-current={state === "current" ? "step" : undefined}>
            <span
              className={`flex size-7 items-center justify-center rounded-full border text-xs font-semibold ${
                state === "current" ? "border-brick bg-brick text-white" : state === "done" ? "border-navy bg-navy text-white" : "border-line bg-white text-muted"
              }`}
            >
              {state === "done" ? "✓" : n}
            </span>
            <span className={state === "current" ? "font-semibold text-navy" : "text-muted"}>
              {label}
              {state === "done" && <span className="sr-only"> (완료)</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
