import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader, ReadOnlyNotice } from "@/components/admin/ui";
import { requireAdmin } from "@/server/auth/current";
import { canManage } from "@/server/auth/permissions";
import { db } from "@/server/db/client";
import { discountRules } from "@/server/db/schema";
import { saveDiscountAction } from "../actions";
import { DiscountForm } from "../discount-form";

export const metadata: Metadata = { title: "감면 규칙" };

export default async function EditDiscountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = await requireAdmin();
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [rule] = await db.select().from(discountRules).where(eq(discountRules.id, id));
  if (!rule) notFound();
  const editable = canManage(admin.role, "discounts");
  return (
    <div>
      <PageHeader title={rule.name} crumbs={[{ href: "/admin/settings", label: "정책 설정" }, { href: "/admin/settings/discounts", label: "감면" }]} />
      {!editable && <ReadOnlyNotice />}
      <DiscountForm
        action={saveDiscountAction.bind(null, rule.id)}
        editable={editable}
        initial={{
          name: rule.name,
          description: rule.description,
          kind: rule.kind,
          value: String(rule.value),
          proofRequired: String(rule.proofRequired),
          proofGuide: rule.proofGuide,
          isActive: String(rule.isActive),
          sortOrder: String(rule.sortOrder),
        }}
      />
    </div>
  );
}
