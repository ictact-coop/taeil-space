import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { settingGroups, type SettingGroup } from "@/domain/settings/define";
import { toKstLocalInput } from "@/lib/time";
import { requireAdmin } from "@/server/auth/current";
import { db } from "@/server/db/client";
import { loadPolicyRows } from "@/server/settings/service";
import { buildFieldViews } from "@/server/settings/view";
import { saveSettingsAction } from "./actions";
import { SettingsForm } from "./settings-form";

function isGroup(value: string): value is SettingGroup {
  return Object.hasOwn(settingGroups, value);
}

export async function generateMetadata({ params }: { params: Promise<{ group: string }> }): Promise<Metadata> {
  const { group } = await params;
  return { title: isGroup(group) ? `${settingGroups[group].label} 설정` : "설정" };
}

export default async function SettingsGroupPage({ params }: { params: Promise<{ group: string }> }) {
  const { group } = await params;
  if (!isGroup(group)) notFound();
  const admin = await requireAdmin();
  const now = new Date();
  const fields = buildFieldViews(group, await loadPolicyRows(db), admin.role, now);

  return (
    <div className="mx-auto max-w-4xl">
      <nav aria-label="위치" className="mb-2 text-sm text-muted">
        <Link href="/admin/settings" className="underline">
          정책 설정
        </Link>{" "}
        / {settingGroups[group].label}
      </nav>
      <h1 className="text-2xl font-bold text-navy">{settingGroups[group].label}</h1>
      <p className="mt-1 mb-6 text-sm text-muted">{settingGroups[group].description}</p>
      <SettingsForm
        fields={fields}
        action={saveSettingsAction.bind(null, group)}
        canEditAny={fields.some((f) => f.editable)}
        nowLocal={toKstLocalInput(now)}
      />
    </div>
  );
}
