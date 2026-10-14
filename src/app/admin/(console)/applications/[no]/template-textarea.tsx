"use client";

import { useId, useState } from "react";
import { fillTemplate, type MessageTemplate, type TemplateVars } from "@/domain/messages/template";

/** 정책 설정의 문구 모음에서 골라 넣을 수 있는 입력칸(반려 사유·보완 요청). 넣은 뒤에도 고칠 수 있다 */
export function TemplateTextarea({
  name,
  label,
  templates,
  vars,
  rows = 3,
}: {
  name: string;
  label: string;
  templates: MessageTemplate[];
  vars: TemplateVars;
  rows?: number;
}) {
  const [value, setValue] = useState("");
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {templates.length > 0 && (
        <select
          aria-label={`${label} 문구 고르기`}
          className="input text-xs"
          value=""
          onChange={(e) => {
            const t = templates[Number(e.target.value)];
            if (t && (value.trim() === "" || window.confirm("입력한 내용을 고른 문구로 바꿀까요?"))) setValue(fillTemplate(t.body, vars));
          }}
        >
          <option value="">자주 쓰는 문구 넣기…</option>
          {templates.map((t, i) => (
            <option key={t.title + i} value={i}>
              {t.title}
            </option>
          ))}
        </select>
      )}
      <textarea id={id} name={name} required rows={rows} className="input" placeholder="신청자에게 전달됩니다." value={value} onChange={(e) => setValue(e.target.value)} />
    </div>
  );
}
