import type { Metadata } from "next";
import { PageHeader } from "@/components/admin/ui";
import { requireAdmin } from "@/server/auth/current";
import { saveDiscountAction } from "../actions";
import { DiscountForm } from "../discount-form";

export const metadata: Metadata = { title: "감면 규칙 추가" };

export default async function NewDiscountPage() {
  await requireAdmin(["system"]);
  return (
    <div>
      <PageHeader title="감면 규칙 추가" crumbs={[{ href: "/admin/settings", label: "정책 설정" }, { href: "/admin/settings/discounts", label: "감면" }]} />
      <DiscountForm
        action={saveDiscountAction.bind(null, null)}
        editable
        initial={{ name: "", description: "", kind: "percent", value: "50", proofRequired: "true", proofGuide: "", isActive: "true", sortOrder: "0" }}
      />
    </div>
  );
}
