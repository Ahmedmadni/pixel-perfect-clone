import { describe, expect, it } from "vitest";
import {
  canDecideApproval, effectiveApprovalStatus, filterApprovals, summarizeApprovals,
} from "./approval-view";
import type { ApprovalRequest } from "./api/types";

const now = Date.parse("2026-10-17T12:00:00Z");
const base = {
  kind: "external_message" as const, target: "حساب تجريبي", risk: "medium" as const,
  preview: "هذه مسودة وهمية لا تُرسل إلى أي حساب",
};
const approvals: ApprovalRequest[] = [
  { ...base, id:"1", action:"رد واتساب تجريبي", createdAt:"2026-10-17T09:00:00Z",expiresAt:"2026-10-17T13:00:00Z",status:"pending" },
  { ...base, id:"2", action:"انتهى وقتها", createdAt:"2026-10-17T11:00:00Z",expiresAt:"2026-10-17T11:30:00Z",status:"pending" },
  { ...base, id:"3", action:"مسودة معتمدة", createdAt:"2026-10-17T10:00:00Z",expiresAt:"2026-10-17T11:00:00Z",status:"approved" },
  { ...base, id:"4", action:"تم رفضها", createdAt:"2026-10-17T08:00:00Z",status:"rejected", risk:"high" },
];
describe("approval presentation cannot bypass backend authorization", () => {
  it("treats expired pending draft as expired only for display", () => {
    expect(effectiveApprovalStatus(approvals[1]!,now)).toBe("expired");
    expect(approvals[1]!.status).toBe("pending");
    expect(canDecideApproval(approvals[1]!,now)).toBe(false);
    expect(canDecideApproval(approvals[0]!,now)).toBe(true);
  });
  it("never revives rejected or approved drafts regardless of expiry", () => {
    expect(effectiveApprovalStatus(approvals[2]!,now)).toBe("approved");
    expect(canDecideApproval(approvals[3]!,now)).toBe(false);
  });
  it("computes accurate counts without writing source data", () => {
    expect(summarizeApprovals(approvals,now)).toEqual({ total:4,pending:1,approved:1,rejected:1,expired:1 });
    expect(approvals[1]?.status).toBe("pending");
  });
  it("filters by Arabic text, status and risk and sorts newest first", () => {
    expect(filterApprovals(approvals,"all","all","",now).map(a=>a.id)).toEqual(["2","3","1","4"]);
    expect(filterApprovals(approvals,"expired","all","",now).map(a=>a.id)).toEqual(["2"]);
    expect(filterApprovals(approvals,"pending","medium","واتساب",now).map(a=>a.id)).toEqual(["1"]);
    expect(filterApprovals(approvals,"all","high","",now).map(a=>a.id)).toEqual(["4"]);
    expect(filterApprovals(approvals,"approved","high","",now)).toEqual([]);
  });
});
