import { describe, expect, it } from "vitest";
import { approvalsSearch, reportsSearch } from "./workspace-links";

describe("safe read-only task and approval deep links", () => {
  it("accepts a real UUID or a synthetic task ID", () => {
    expect(reportsSearch({taskId:"12345678-1234-4123-8123-123456789abc"})).toEqual({taskId:"12345678-1234-4123-8123-123456789abc"});
    expect(reportsSearch({taskId:"k3"})).toEqual({taskId:"k3"});
  });
  it.each(["", "../other", "javascript:alert(1)", "x".repeat(101), ["k3"], null])(
    "ignores malformed identifiers instead of targeting a different task", (id) => {
      expect(reportsSearch({taskId:id})).toEqual({});
    },
  );
  it("accepts only known approval-status filters", () => {
    expect(approvalsSearch({status:"pending"})).toEqual({status:"pending"});
    expect(approvalsSearch({status:"expired"})).toEqual({status:"expired"});
    expect(approvalsSearch({status:"done"})).toEqual({});
    expect(approvalsSearch({status:["pending"]})).toEqual({});
    expect(approvalsSearch({})).toEqual({});
  });
});
