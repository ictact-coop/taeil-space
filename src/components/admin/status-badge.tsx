import { statusLabels, type ApplicationStatus } from "@/server/applications/transition";

const styles: Partial<Record<ApplicationStatus, string>> = {
  pending_payment: "bg-warning/10 text-warning",
  submitted: "bg-brick/10 text-brick",
  reviewing: "bg-brick/10 text-brick",
  revision_requested: "bg-warning/10 text-warning",
  confirmed: "bg-status-green/10 text-status-green",
  completed: "bg-status-green/10 text-status-green",
};

export function StatusBadge({ status }: { status: ApplicationStatus }) {
  return <span className={`badge ${styles[status] ?? "bg-cream-dark text-muted"}`}>{statusLabels[status]}</span>;
}
