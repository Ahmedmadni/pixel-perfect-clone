import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { StoreUnavailableError } from "./store.ts";

export type TaskStatus = "queued" | "running" | "done" | "failed" | "cancelled";
export type TaskStep = { at: string; phase: "start" | "inspect" | "summarize" | "complete" | "error"; detail: string };
export type AgentTaskRecord = {
  id: string;
  title: string;
  objective: string;
  tabId: string;
  model: string;
  status: TaskStatus;
  result: string | null;
  error: string | null;
  steps: TaskStep[];
  createdAt: string;
  finishedAt: string | null;
};
type Row = {
  id: string; objective: string; tab_id: string; model: string; status: TaskStatus;
  result: string | null; error: string | null; steps: TaskStep[]; created_at: Date; finished_at: Date | null;
};
function convert(r: Row): AgentTaskRecord {
  return {
    id: r.id, title: r.objective.slice(0, 110), objective: r.objective, tabId: r.tab_id,
    model: r.model, status: r.status, result: r.result, error: r.error,
    steps: r.steps, createdAt: r.created_at.toISOString(),
    finishedAt: r.finished_at?.toISOString() ?? null,
  };
}

export interface TaskRepository {
  create(input: { objective: string; tabId: string; model: string }): Promise<AgentTaskRecord>;
  begin(id: string): Promise<void>;
  step(id: string, step: TaskStep): Promise<void>;
  finish(id: string, status: "done" | "failed" | "cancelled", result?: string, error?: string): Promise<void>;
  list(limit: number): Promise<AgentTaskRecord[]>;
  get(id: string): Promise<AgentTaskRecord | null>;
  recover(): Promise<void>;
}

export class PgTaskRepository implements TaskRepository {
  constructor(private readonly pool: Pool) {}
  private async wrap<T>(action: () => Promise<T>) {
    try { return await action(); }
    catch (e) { throw new StoreUnavailableError((e as Error).message); }
  }
  create({ objective, tabId, model }: { objective: string; tabId: string; model: string }) {
    return this.wrap(async () => {
      const r = await this.pool.query<Row>(
        `INSERT INTO agent_tasks(id,objective,tab_id,model,status)
         VALUES ($1,$2,$3,$4,'queued') RETURNING *`,
        [randomUUID(), objective, tabId, model],
      );
      return convert(r.rows[0]!);
    });
  }
  begin(id: string) {
    return this.wrap(async () => {
      const r = await this.pool.query(
        "UPDATE agent_tasks SET status='running',updated_at=now() WHERE id=$1 AND status='queued'",
        [id],
      );
      if (r.rowCount !== 1) throw new Error("task_not_queued");
    });
  }
  step(id: string, step: TaskStep) {
    return this.wrap(async () => {
      await this.pool.query(
        `UPDATE agent_tasks SET steps=steps || $2::jsonb,updated_at=now()
         WHERE id=$1 AND status IN ('queued','running')`,
        [id, JSON.stringify([step])],
      );
    });
  }
  finish(id: string, status: "done" | "failed" | "cancelled", result = "", error = "") {
    return this.wrap(async () => {
      const r = await this.pool.query(
        `UPDATE agent_tasks SET status=$2, result=$3, error=$4,updated_at=now(),
         finished_at=now() WHERE id=$1 AND status IN ('queued','running')`,
        [id, status, result || null, error || null],
      );
      if (r.rowCount !== 1) throw new Error("task_not_active");
    });
  }
  list(limit: number) {
    return this.wrap(async () => {
      const r = await this.pool.query<Row>(
        "SELECT * FROM agent_tasks ORDER BY created_at DESC LIMIT $1", [limit],
      );
      return r.rows.map(convert);
    });
  }
  get(id: string) {
    return this.wrap(async () => {
      const r = await this.pool.query<Row>("SELECT * FROM agent_tasks WHERE id=$1", [id]);
      return r.rows[0] ? convert(r.rows[0]) : null;
    });
  }
  recover() {
    return this.wrap(async () => {
      await this.pool.query(
        `UPDATE agent_tasks SET status='failed',error='Runtime restarted during review',
         updated_at=now(),finished_at=now() WHERE status IN ('queued','running')`,
      );
    });
  }
}
