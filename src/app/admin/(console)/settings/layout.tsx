import { requireAdmin } from "@/server/auth/current";
import { SettingsNav } from "./settings-nav";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin("settings.view");
  return (
    <div className="mx-auto flex max-w-6xl flex-col lg:flex-row lg:gap-8">
      <SettingsNav />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
