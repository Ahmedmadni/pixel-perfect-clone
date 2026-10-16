import { describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { buildApp } from "../src/app.ts";
import { ApprovalConflictError, type ApprovalDraft, type ApprovalRecord, type ApprovalRepository } from "../src/approval-store.ts";
import type { ControlStore } from "../src/store.ts";
import { initialControl } from "../../src/lib/control-machine.ts";

const TOKEN = "a".repeat(64);
const cfg = { RUNTIME_TOKEN: TOKEN, CORS_ORIGINS: ["http://localhost:8080"] };
const auth = { authorization: `Bearer ${TOKEN}` };
function controls(): ControlStore {
  return {
    ping: async () => {},
    getSnapshot: async () => initialControl,
    apply: async () => ({ ok: false, snapshot: initialControl }),
    logs: async () => [],
  };
}
function fakeApprovals(): ApprovalRepository {
  const rows: ApprovalRecord[] = [];
  return {
    list: async () => rows,
    create: async (draft: ApprovalDraft) => {
      const at = new Date().toISOString();
      const item: ApprovalRecord = {
        ...draft, id: randomUUID(),
        risk: draft.kind === "external_message" ? "medium" : "high",
        status: "pending", createdAt: at, decidedAt: null,
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        payloadDigest: createHash("sha256").update(JSON.stringify(draft)).digest("hex"),
        executable: false,
      };
      rows.unshift(item);
      return item;
    },
    decide: async (id, decision, expectedDigest) => {
      const item = rows.find((r) => r.id === id);
      if (!item || item.status !== "pending" || item.payloadDigest !== expectedDigest)
        throw new ApprovalConflictError("stale_or_duplicate");
      item.status = decision === "approve" ? "approved" : "rejected";
      item.decidedAt = new Date().toISOString();
      return item;
    },
  };
}
const draft = {
  kind: "external_message", action: "صياغة رد", target: "عميل محتمل",
  preview: "شكرًا لتواصلك، سنعود إليك قريبًا",
} as const;

describe("secure immutable human draft approvals", () => {
  it("rejects anonymous and foreign origin requests", async () => {
    const app = await buildApp(cfg, controls(), {approvals:fakeApprovals()});
    expect((await app.inject({url:"/v1/approvals"})).statusCode).toBe(401);
    expect((await app.inject({url:"/v1/approvals", headers: {...auth,origin:"https://untrusted.example"}})).statusCode).toBe(403);
    await app.close();
  });
  it("shows 503 instead of fake data when DB approval service is absent", async () => {
    const app = await buildApp(cfg, controls());
    expect((await app.inject({url:"/v1/approvals",headers:auth})).statusCode).toBe(503);
    await app.close();
  });
  it("validates category and content; server never accepts client risk flags", async () => {
    const app = await buildApp(cfg, controls(), {approvals:fakeApprovals()});
    for(const wrong of [
      {...draft,kind:"system_superuser"},
      {...draft,preview:""},
      {...draft,risk:"low"},
      {...draft, target:"x".repeat(300)},
    ]) {
      expect((await app.inject({url:"/v1/approvals",method:"POST",headers:auth,payload:wrong})).statusCode).toBe(400);
    }
    await app.close();
  });
  it("requires the exact preview digest and makes each decision final", async () => {
    const app = await buildApp(cfg, controls(), {approvals:fakeApprovals()});
    const created = await app.inject({url:"/v1/approvals",method:"POST",headers:auth,payload:draft});
    expect(created.statusCode).toBe(201);
    const item = created.json() as ApprovalRecord;
    expect(item.executable).toBe(false);
    expect(item.risk).toBe("medium");
    const invalid=await app.inject({url:`/v1/approvals/${item.id}`,method:"POST",headers:auth,
      payload:{decision:"approve",expectedDigest:"b".repeat(64)}});
    expect(invalid.statusCode).toBe(409);
    const approved=await app.inject({url:`/v1/approvals/${item.id}`,method:"POST",headers:auth,
      payload:{decision:"approve",expectedDigest:item.payloadDigest}});
    expect(approved.statusCode).toBe(200);
    expect(approved.json().status).toBe("approved");
    expect(approved.json().executable).toBe(false);
    const duplicate=await app.inject({url:`/v1/approvals/${item.id}`,method:"POST",headers:auth,
      payload:{decision:"approve",expectedDigest:item.payloadDigest}});
    expect(duplicate.statusCode).toBe(409);
    await app.close();
  });
});
