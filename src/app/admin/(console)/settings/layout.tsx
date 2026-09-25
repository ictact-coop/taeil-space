import { SettingsNav } from "./settings-nav";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex max-w-6xl flex-col lg:flex-row lg:gap-8">
      <SettingsNav />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
