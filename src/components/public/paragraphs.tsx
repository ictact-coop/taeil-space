/** 관리자가 입력한 여러 줄 문구를 문단·줄바꿈으로 보여 준다(HTML은 해석하지 않음). */
export function Paragraphs({ text, className = "" }: { text: string; className?: string }) {
  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      {text
        .split(/\n{2,}/)
        .filter((p) => p.trim() !== "")
        .map((p, i) => (
          <p key={i} className="whitespace-pre-line">
            {p}
          </p>
        ))}
    </div>
  );
}
