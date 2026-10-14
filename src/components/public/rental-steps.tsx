/**
 * 첫 페이지 '대관 절차' 그림(기념관 제공 이미지의 모양을 코드로 옮긴 것).
 * 원 안에 아이콘과 단계 이름, 사이에 화살표. 좁은 화면에서는 2×2로 줄바꿈한다.
 */
const icon = "size-10 sm:size-12";
const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

function CalendarIcon() {
  return (
    <svg viewBox="0 0 48 48" className={icon} aria-hidden {...stroke}>
      <rect x="7" y="10" width="34" height="31" rx="3" />
      <path d="M7 19h34M16 6v8M32 6v8" />
      <path d="M17 30l5 5 9-10" strokeWidth={2.2} />
    </svg>
  );
}

function EnvelopePlusIcon() {
  return (
    <svg viewBox="0 0 48 48" className={icon} aria-hidden {...stroke}>
      <path d="M30 37H8a2 2 0 0 1-2-2V13a2 2 0 0 1 2-2h32a2 2 0 0 1 2 2v13" />
      <path d="M6.5 12.5 24 26l17.5-13.5" />
      <circle cx="37" cy="36" r="7" fill="currentColor" stroke="none" />
      <path d="M37 32v8M33 36h8" stroke="white" strokeWidth={2} />
    </svg>
  );
}

function BankIcon() {
  return (
    <svg viewBox="0 0 48 48" className={icon} aria-hidden {...stroke}>
      <path d="M5 16 21 7l16 9H5z" fill="currentColor" />
      <path d="M9 19v15M16 19v15M26 19v15M33 19v8" strokeWidth={3} />
      <path d="M5 37h25" strokeWidth={2.4} />
      <ellipse cx="38" cy="31" rx="6" ry="2.2" />
      <path d="M32 31v4c0 1.2 2.7 2.2 6 2.2s6-1 6-2.2v-4M32 35v4c0 1.2 2.7 2.2 6 2.2s6-1 6-2.2v-4" />
    </svg>
  );
}

function ReviewIcon() {
  return (
    <svg viewBox="0 0 48 48" className={icon} aria-hidden {...stroke}>
      <circle cx="17" cy="16" r="6" fill="currentColor" stroke="none" />
      <path d="M5 38c0-7 5.4-12 12-12 3 0 5.7 1 7.8 2.8" fill="currentColor" stroke="none" />
      <path d="M26 6h12l5 5v14" />
      <path d="M30 13h8M30 18h9" />
      <circle cx="36" cy="35" r="7" fill="currentColor" stroke="none" />
      <path d="M32.5 35l2.5 2.5 4.5-5" stroke="white" strokeWidth={2} />
    </svg>
  );
}

export const RENTAL_STEPS = [
  { title: "공간·일정 선택", Icon: CalendarIcon },
  { title: "온라인 대관 신청", Icon: EnvelopePlusIcon },
  { title: "시설이용료 납부", Icon: BankIcon },
  { title: "담당자 검토 및 승인", Icon: ReviewIcon },
] as const;

export function RentalSteps() {
  return (
    <ol className="grid grid-cols-2 justify-items-center gap-6 sm:gap-8 md:flex md:items-center md:justify-center md:gap-0" aria-label="대관 절차">
      {RENTAL_STEPS.map(({ title, Icon }, i) => (
        <li key={title} className="flex items-center">
          {i > 0 && (
            <svg viewBox="0 0 24 24" className="mx-3 hidden size-6 text-muted lg:mx-6 md:block" aria-hidden fill="none" stroke="currentColor" strokeWidth={1.8}>
              <path d="M4 12h15M14 7l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
          <div className="flex size-36 flex-col items-center justify-center gap-2 rounded-full border-[6px] border-[#b9b5ad] bg-[#ebe8e2] text-center text-ink sm:size-40">
            <span className="sr-only">{i + 1}단계</span>
            <Icon />
            <span className="px-3 text-sm leading-snug font-bold break-keep sm:text-base">{title}</span>
          </div>
        </li>
      ))}
    </ol>
  );
}
