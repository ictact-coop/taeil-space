export default function HomePage() {
  return (
    <main className="min-h-dvh bg-navy text-white">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-6 py-24">
        <p className="text-xs font-semibold tracking-[0.2em] text-brick">SPACE RENTAL · 2026</p>
        <h1 className="font-serif text-4xl leading-tight sm:text-5xl">
          모임의 뜻이
          <br />
          <span className="text-[#e98b6f]">이어지는 공간</span>
        </h1>
        <p className="max-w-xl text-white/80">
          전태일기념관 온라인 대관 신청을 준비하고 있습니다. 문의는 대표번호 02-318-0903~4로 연락해 주세요.
        </p>
      </div>
    </main>
  );
}
