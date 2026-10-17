import type { ApprovalRequest } from "./api/types";

export type ApprovalListStatus = ApprovalRequest["status"] | "all";
const approvalStatuses: readonly ApprovalListStatus[] = ["all","pending","approved","rejected","expired"];

/** Strict, read-only URL search parsing. No IDs are used for authorization. */
export function reportsSearch(input: Record<string, unknown>): { taskId?: string } {
  const value = input["taskId"];
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(value)) return {};
  return {taskId:value};
}

export function approvalsSearch(input: Record<string, unknown>): { status?: ApprovalListStatus } {
  const value = input["status"];
  if (typeof value !== "string" || !approvalStatuses.includes(value as ApprovalListStatus)) return {};
  return {status:value as ApprovalListStatus};
}
