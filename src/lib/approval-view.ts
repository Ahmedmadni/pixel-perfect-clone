import type { ApprovalRequest } from "./api/types";

export type ApprovalStatus = ApprovalRequest["status"];
export type ApprovalFilter = ApprovalStatus | "all";
export type ApprovalRiskFilter = ApprovalRequest["risk"] | "all";

export const APPROVAL_STATES: readonly ApprovalStatus[] = ["pending", "approved", "rejected", "expired"];
export const APPROVAL_LABELS: Record<ApprovalStatus, string> = {
  pending: "بانتظار المراجعة",
  approved: "مسودة معتمدة",
  rejected: "مرفوضة",
  expired: "منتهية الصلاحية",
};
export const RISK_LABELS: Record<ApprovalRequest["risk"], string> = {
  low: "منخفضة", medium: "متوسطة", high: "عالية",
};

/** Local visual expiry is a warning only; actual authorization is rechecked by the backend. */
export function effectiveApprovalStatus(
  item: ApprovalRequest, now: number = Date.now(),
): ApprovalStatus {
  if (item.status === "pending" && item.expiresAt) {
    const expiry = Date.parse(item.expiresAt);
    if (Number.isFinite(expiry) && expiry <= now) return "expired";
  }
  return item.status;
}

export function canDecideApproval(item: ApprovalRequest, now: number = Date.now()) {
  return effectiveApprovalStatus(item, now) === "pending";
}

export function summarizeApprovals(items: readonly ApprovalRequest[], now: number = Date.now()) {
  const counters: Record<ApprovalStatus, number> = {
    pending: 0, approved: 0, rejected: 0, expired: 0,
  };
  for (const item of items) counters[effectiveApprovalStatus(item, now)]++;
  return { total: items.length, ...counters };
}

export function filterApprovals(
  items: readonly ApprovalRequest[], status: ApprovalFilter, risk: ApprovalRiskFilter,
  search: string, now: number = Date.now(),
): ApprovalRequest[] {
  const query = search.trim().toLocaleLowerCase("ar");
  return items
    .filter((a) => {
      const state = effectiveApprovalStatus(a, now);
      return (status === "all" || state === status) &&
        (risk === "all" || risk === a.risk) &&
        (!query || [a.action,a.target,a.kind,a.preview,APPROVAL_LABELS[state],RISK_LABELS[a.risk]]
          .join(" ").toLocaleLowerCase("ar").includes(query));
    })
    .sort((a,b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}
