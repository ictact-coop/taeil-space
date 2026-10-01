import { feeOptionUnitLabels, formatMinutes, formatWon, type FeeScheduleItems } from "@/domain/pricing/fee-schedule";

export function FeeTable({ items, spaces }: { items: FeeScheduleItems; spaces: { id: string; name: string }[] }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="bg-cream text-xs text-muted">
            <tr>
              <th scope="col" className="px-3 py-2">공간</th>
              <th scope="col" className="px-3 py-2">기본시간</th>
              <th scope="col" className="px-3 py-2">기본요금</th>
              <th scope="col" className="px-3 py-2">추가요금</th>
              <th scope="col" className="px-3 py-2">야간요금</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {spaces.map((s) => {
              const f = items.spaces[s.id];
              return (
                <tr key={s.id}>
                  <td className="px-3 py-2 font-medium">{s.name}</td>
                  {f ? (
                    <>
                      <td className="px-3 py-2">{formatMinutes(f.baseMinutes)}</td>
                      <td className="px-3 py-2">{formatWon(f.baseFee)}</td>
                      <td className="px-3 py-2">
                        {formatMinutes(f.extraUnitMinutes)}당 {formatWon(f.extraFee)}
                      </td>
                      <td className="px-3 py-2">시간당 {formatWon(f.nightFeePerHour)}</td>
                    </>
                  ) : (
                    <td colSpan={4} className="px-3 py-2 text-muted">
                      요금 없음
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {items.options.length > 0 && (
        <p className="text-xs text-muted">
          옵션: {items.options.map((o) => `${o.name} ${feeOptionUnitLabels[o.unit]} ${formatWon(o.fee)}`).join(" · ")}
        </p>
      )}
    </div>
  );
}
