import type { Pool, PoolClient } from "pg";
import {
  nextState,
  type ControlEvent,
  type ControlSnapshot,
  type ControlState,
} from "../../src/lib/control-machine.ts";
import type { ActivityLog } from "../../src/lib/api/types.ts";

export class StoreUnavailableError extends Error {}

export type ApplyResult =
  | { ok: true; snapshot: ControlSnapshot }
  | { ok: false; snapshot: ControlSnapshot };

export interface ControlStore {
  ping(): Promise<void>;
  getSnapshot(): Promise<ControlSnapshot>;
  apply(event: ControlEvent, actor: "user" | "agent" | "system"): Promise<ApplyResult>;
  logs(limit: number): Promise<ActivityLog[]>;
}

const ACTIVE: ControlState[] = ["AGENT_ACTIVE", "APPROVAL_REQUIRED", "PAUSED"];

/**
 * PostgreSQL-backed store. Every mutation runs in a transaction that locks the
 * single control_state row (SELECT ... FOR UPDATE), so concurrent requests are
 * serialized. Any DB failure surfaces as StoreUnavailableError → callers fail closed.
 */
export class PgControlStore implements ControlStore {
  private ready: Promise<void> | null = null;
  constructor(private pool: Pool) {}

  private async wrap<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof StoreUnavailableError) throw e;
      throw new StoreUnavailableError((e as Error).message);
    }
  }

  private async tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      const r = await fn(c);
      await c.query("COMMIT");
      return r;
    } catch (e) {
      await c.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }

  /** Once per process: never resume an active agent after a restart. */
  private ensureReady(): Promise<void> {
    if (!this.ready) {
      this.ready = this.tx(async (c) => {
        const r = await c.query<{ state: ControlState }>(
          "SELECT state FROM control_state WHERE id = 1 FOR UPDATE",
        );
        const cur = r.rows[0]?.state;
        if (!cur) throw new Error("control_state row missing — run `npm run migrate`");
        if (ACTIVE.includes(cur)) {
          await c.query(
            "UPDATE control_state SET state='STOPPED', reason=$1, updated_at=now() WHERE id=1",
            ["runtime restarted while agent was active"],
          );
          await c.query(
            `INSERT INTO audit_logs (level, actor, message, event, from_state, to_state)
             VALUES ('audit','system',$1,'STARTUP_RESET',$2,'STOPPED')`,
            [`Startup safety reset: ${cur} → STOPPED`, cur],
          );
        }
        await c.query(
          "INSERT INTO audit_logs (level, actor, message) VALUES ('info','system',$1)",
          [`Runtime started; control state ${ACTIVE.includes(cur) ? "STOPPED" : cur}`],
        );
      }).catch((e) => {
        this.ready = null; // retry on next call
        throw e;
      });
    }
    return this.ready;
  }

  ping() {
    return this.wrap(async () => {
      await this.pool.query("SELECT 1");
    });
  }

  private async read(c: Pool | PoolClient): Promise<ControlSnapshot> {
    const s = await c.query<{ state: ControlState; reason: string | null }>(
      "SELECT state, reason FROM control_state WHERE id = 1",
    );
    const h = await c.query<{
      at: Date;
      from_state: ControlState;
      to_state: ControlState;
      event: ControlSnapshot["history"][number]["event"];
    }>(
      `SELECT at, from_state, to_state, event FROM audit_logs
       WHERE to_state IS NOT NULL ORDER BY id DESC LIMIT 100`,
    );
    const row = s.rows[0];
    if (!row) throw new Error("control_state row missing");
    return {
      state: row.state,
      reason: row.reason,
      history: h.rows.map((x) => ({
        at: x.at.toISOString(),
        from: x.from_state,
        to: x.to_state,
        event: x.event,
      })),
    };
  }

  getSnapshot() {
    return this.wrap(async () => {
      await this.ensureReady();
      return this.read(this.pool);
    });
  }

  apply(event: ControlEvent, actor: "user" | "agent" | "system") {
    return this.wrap(async () => {
      await this.ensureReady();
      const result = await this.tx(async (c) => {
        const r = await c.query<{ state: ControlState }>(
          "SELECT state FROM control_state WHERE id = 1 FOR UPDATE",
        );
        const from = r.rows[0]!.state;
        const to = nextState(from, event.type);
        if (!to) return { ok: false as const, from };
        const reason =
          event.type === "REQUEST_APPROVAL" ? event.reason : event.type === "FAIL" ? event.error : null;
        await c.query(
          "UPDATE control_state SET state=$1, reason=$2, updated_at=now() WHERE id=1",
          [to, reason],
        );
        await c.query(
          `INSERT INTO audit_logs (level, actor, message, event, from_state, to_state)
           VALUES ('audit',$1,$2,$3,$4,$5)`,
          [actor, `${event.type}: ${from} → ${to}${reason ? ` (${reason})` : ""}`, event.type, from, to],
        );
        return { ok: true as const, from };
      });
      if (!result.ok) {
        await this.pool.query(
          "INSERT INTO audit_logs (level, actor, message, event) VALUES ('warn',$1,$2,$3)",
          [actor, `Rejected ${event.type} in ${result.from}`, event.type],
        );
      }
      return { ok: result.ok, snapshot: await this.read(this.pool) } as ApplyResult;
    });
  }

  logs(limit: number) {
    return this.wrap(async () => {
      await this.ensureReady();
      const r = await this.pool.query<{
        id: string;
        at: Date;
        level: ActivityLog["level"];
        actor: ActivityLog["actor"];
        message: string;
      }>("SELECT id::text, at, level, actor, message FROM audit_logs ORDER BY id DESC LIMIT $1", [limit]);
      return r.rows.map((x) => ({ ...x, at: x.at.toISOString() }));
    });
  }
}
