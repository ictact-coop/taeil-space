import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/admin/ui";
import type { ReceiptRequest } from "@/domain/booking/receipt";
import { fromMinutes } from "@/domain/booking/time";
import { formatRegNo } from "@/domain/organization/reg-no";
import { kstDateOf } from "@/lib/time";
import { toMinutesOfDay } from "@/lib/time-of-day";
import { getApplicationForAdmin } from "@/server/applications/admin-queries";
import { requireAdmin } from "@/server/auth/current";
import { ACTIVE_APPLICATION_STATUSES } from "@/server/calendar/closure-service";
import { db } from "@/server/db/client";
import { spaces } from "@/server/db/schema";
import { editApplicationAction } from "./actions";
import { EditApplicationForm } from "./edit-form";

export const metadata: Metadata = { title: "신청 정보 수정" };

function receiptInitial(r: ReceiptRequest | null): Record<string, string> {
  if (!r) return { receiptType: "none" };
  if (r.type === "cash") return { receiptType: "cash", cashPurpose: r.purpose, cashNumber: r.number };
  return { receiptType: "tax_invoice", taxBizNo: formatRegNo(r.bizNo), taxCompany: r.company, taxCeo: r.ceo, taxEmail: r.email, taxAddress: r.address, taxBizType: r.bizType, taxBizItem: r.bizItem };
}

export default async function EditApplicationPage({ params }: { params: Promise<{ no: string }> }) {
  const { no } = await params;
  await requireAdmin("applications.review");
  const data = await getApplicationForAdmin(db, no);
  if (!data) notFound();
  const { app, org } = data;
  const spaceList = await db.select({ id: spaces.id, name: spaces.name }).from(spaces).orderBy(spaces.sortOrder, spaces.name);
  const initial = {
    spaceId: app.spaceId ?? "",
    date: kstDateOf(app.startsAt),
    start: fromMinutes(toMinutesOfDay(app.startsAt)),
    end: fromMinutes(toMinutesOfDay(app.endsAt) || 24 * 60),
    orgName: app.orgName,
    regType: org?.regType ?? "",
    regNo: org ? formatRegNo(org.regNo) : "",
    contactName: app.contactName,
    contactPhone: app.contactPhone,
    contactEmail: app.contactEmail,
    eventTitle: app.eventTitle,
    eventPurpose: app.eventPurpose,
    expectedHeadcount: String(app.expectedHeadcount),
    ...receiptInitial(app.receiptRequest as ReceiptRequest | null),
  };
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={`${app.applicationNo} 신청 정보 수정`}
        description="전화·메일로 받은 변경 요청이나 오타를 고칩니다. 바뀐 항목은 처리 이력과 감사 로그에 남습니다. 감면은 상세 화면의 '감면 적용·변경'에서 바꿉니다."
        crumbs={[
          { href: "/admin/applications", label: "신청 관리" },
          { href: `/admin/applications/${app.applicationNo}`, label: app.applicationNo },
        ]}
      />
      <EditApplicationForm
        action={editApplicationAction.bind(null, app.applicationNo, app.id)}
        initial={initial}
        spaces={spaceList}
        scheduleEditable={(ACTIVE_APPLICATION_STATUSES as readonly string[]).includes(app.status)}
        pending={app.status === "pending_payment"}
        hasEmail={Boolean(app.contactEmail)}
      />
    </div>
  );
}
