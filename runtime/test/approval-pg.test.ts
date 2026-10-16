/** Optional REAL PostgreSQL security test; set TEST_DATABASE_URL to a disposable test DB only. */
import pg from "pg";
import { describe, expect, it } from "vitest";
import { migrate } from "../src/migrate.ts";
import { PgApprovalRepository, ApprovalConflictError } from "../src/approval-store.ts";

const db = process.env["TEST_DATABASE_URL"];
describe.skipIf(!db)("PostgreSQL approval drafts (real disposable test DB)", () => {
  it("persists immutable content, digest-matched decisions, and rejects duplicates", async () => {
    await migrate(db!);
    const pool = new pg.Pool({connectionString:db!});
    try {
      const approvals = new PgApprovalRepository(pool);
      const created = await approvals.create({
        kind:"publish_comment", action:"مراجعة تعليق", target:"صفحة عمل تجريبية",
        preview:"هذا نص للاعتماد اليدوي فقط، دون تنفيذ.",
      });
      expect(created.risk).toBe("high");
      expect(created.executable).toBe(false);
      expect(created.payloadDigest).toMatch(/^[a-f0-9]{64}$/);
      expect(created.status).toBe("pending");
      const found = (await approvals.list(100)).find((a)=>a.id===created.id);
      expect(found?.preview).toBe(created.preview);
      await expect(approvals.decide(created.id,"approve","0".repeat(64)))
        .rejects.toBeInstanceOf(ApprovalConflictError);
      const approved = await approvals.decide(created.id,"approve",created.payloadDigest);
      expect(approved.status).toBe("approved");
      expect(approved.executable).toBe(false);
      await expect(approvals.decide(created.id,"reject",created.payloadDigest))
        .rejects.toBeInstanceOf(ApprovalConflictError);
      // The database itself blocks swapping the reviewed text after a decision.
      await expect(pool.query("UPDATE approval_requests SET preview=$2 WHERE id=$1",
        [created.id,"A different text after approval"]))
        .rejects.toThrow(/immutable/i);
      expect((await approvals.list(100)).find((a)=>a.id===created.id)?.preview).toBe(created.preview);
    } finally {await pool.end();}
  });
});
