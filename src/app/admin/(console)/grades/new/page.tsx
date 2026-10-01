import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/admin/ui";
import { requireAdmin } from "@/server/auth/current";
import { createGradeAction } from "../actions";
import { GradeForm } from "../grade-form";

export const metadata: Metadata = { title: "새 등급" };

export default async function NewGradePage() {
  const admin = await requireAdmin();
  if (!admin.isSuper) redirect("/admin?denied=1");
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader title="새 등급" crumbs={[{ href: "/admin/grades", label: "등급 관리" }]} />
      <Card>
        <GradeForm action={createGradeAction} submitLabel="등급 만들기" />
      </Card>
    </div>
  );
}
