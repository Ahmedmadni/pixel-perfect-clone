import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { StoreUnavailableError } from "./store.ts";

export type ApprovalKind = "external_message" | "publish_comment" | "project_change" | "other";
export type ApprovalDecision = "approve" | "reject";
export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired";
export type ApprovalRisk = "low" | "medium" | "high";

export interface ApprovalDraft {
  kind: ApprovalKind;
  action: string;
  target: string;
  preview: string;
}
export interface ApprovalRecord {
  id: string;
  kind: ApprovalKind;
  action: string;
  target: string;
  preview: string;
  risk: ApprovalRisk;
  status: ApprovalStatus;
  createdAt: string;
  expiresAt: string;
  decidedAt: string | null;
  payloadDigest: string;
  executable: false;
}
export class ApprovalConflictError extends Error {}
export class ApprovalNotFoundError extends Error {}
export interface ApprovalRepository {
  list(limit: number): Promise<ApprovalRecord[]>;
  create(draft: ApprovalDraft): Promise<ApprovalRecord>;
  decide(id: string, decision: ApprovalDecision, expectedDigest: string): Promise<ApprovalRecord>;
}
type Row = {
  id: string; kind: ApprovalKind; action_label: string; target: string; preview: string;
  risk: ApprovalRisk; status: ApprovalStatus; payload_digest: string;
  created_at: Date; expires_at: Date; decided_at: Date | null;
};
function fromRow(r: Row): ApprovalRecord {
  return {
    id: r.id, kind: r.kind, action: r.action_label, target: r.target,
    preview: r.preview, risk: r.risk, status: r.status,
    createdAt: r.created_at.toISOString(), expiresAt: r.expires_at.toISOString(),
    decidedAt: r.decided_at?.toISOString() ?? null, payloadDigest: r.payload_digest,
    executable: false, // human approval NEVER grants automatic dispatch
  };
}
function riskFor(kind: ApprovalKind): ApprovalRisk {
  return kind === "external_message" ? "medium" : "high";
}
function hash(draft: ApprovalDraft, id: string, expiresAt: string): string {
  return createHash("sha256").update(JSON.stringify({
    id, kind: draft.kind, action: draft.action, target: draft.target,
    preview: draft.preview, expiresAt,
  })).digest("hex");
}

export class PgApprovalRepository implements ApprovalRepository {
  constructor(private readonly pool: Pool) {}
  private async wrap<T>(fn: () => Promise<T>): Promise<T> {
    try { return await fn(); }
    catch (e) {
      if (e instanceof ApprovalConflictError || e instanceof ApprovalNotFoundError) throw e;
      throw new StoreUnavailableError((e as Error).message);
    }
  }
  private async tx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      const v = await fn(c);
      await c.query("COMMIT");
      return v;
    } catch (e) {
      await c.query("ROLLBACK").catch(() => {});
      throw e;
    } finally { c.release(); }
  }
  private async expire() {
    await this.pool.query(
      `UPDATE approval_requests SET status='expired', decided_at=now()
       WHERE status='pending' AND expires_at <= now()`,
    );
  }
  list(limit: number) {
    return this.wrap(async () => {
      await this.expire();
      const rows = await this.pool.query<Row>(
        "SELECT * FROM approval_requests ORDER BY created_at DESC LIMIT $1", [Math.max(1,Math.min(limit,100))],
      );
      return rows.rows.map(fromRow);
    });
  }
  create(draft: ApprovalDraft) {
    return this.wrap(async () => {
      const id = randomUUID();
      // One-hour expiry prevents approving stale external messages.
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      const digest = hash(draft,id,expiresAt);
      return this.tx(async (c) => {
        const r = await c.query<Row>(
          `INSERT INTO approval_requests
           (id,kind,action_label,target,preview,payload_digest,risk,status,origin,expires_at)
           VALUES($1,$2,$3,$4,$5,$6,$7,'pending','user',$8)
           RETURNING *`,
          [id,draft.kind,draft.action,draft.target,draft.preview,digest,riskFor(draft.kind),expiresAt],
        );
        await c.query(
          "INSERT INTO audit_logs(level,actor,message) VALUES('audit','user',$1)",
          [`Created approval draft ${id}; no external action executed`],
        );
        return fromRow(r.rows[0]!);
      });
    });
  }
  decide(id: string, decision: ApprovalDecision, expectedDigest: string) {
    return this.wrap(async () => {
      const outcome = await this.tx(async (c) => {
        const row = await c.query<Row>("SELECT * FROM approval_requests WHERE id=$1 FOR UPDATE", [id]);
        const current = row.rows[0];
        if (!current) throw new ApprovalNotFoundError("Approval not found");
        if (current.status !== "pending") return { error: "already_decided" as const };
        if (current.expires_at.getTime() <= Date.now()) {
          await c.query(
            "UPDATE approval_requests SET status='expired',decided_at=now() WHERE id=$1",
            [id],
          );
          return { error: "expired" as const };
        }
        if (current.payload_digest !== expectedDigest) return { error: "content_changed" as const };
        const status: ApprovalStatus = decision === "approve" ? "approved" : "rejected";
        const updated = await c.query<Row>(
          "UPDATE approval_requests SET status=$2,decided_at=now() WHERE id=$1 RETURNING *",
          [id,status],
        );
        await c.query(
          "INSERT INTO audit_logs(level,actor,message) VALUES('audit','user',$1)",
          [`Decision ${status} on immutable draft ${id}; no action executed`],
        );
        return { value: fromRow(updated.rows[0]!) };
      });
      if ("error" in outcome) throw new ApprovalConflictError(outcome.error);
      return outcome.value!;
    });
  }
}
