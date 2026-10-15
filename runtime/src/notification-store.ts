import type { Pool } from "pg";
import { StoreUnavailableError } from "./store.ts";

export interface LocalNotification {
  id: string;
  taskId: string | null;
  kind: "task_done" | "task_failed" | "task_cancelled";
  message: string;
  createdAt: string;
  readAt: string | null;
}

export interface NotificationRepository {
  list(limit: number): Promise<LocalNotification[]>;
  markRead(id: string): Promise<boolean>;
}

type Row = {
  id: string; task_id: string | null; kind: LocalNotification["kind"];
  message: string; created_at: Date; read_at: Date | null;
};

export class PgNotificationRepository implements NotificationRepository {
  constructor(private readonly pool: Pool) {}
  private async call<T>(fn: () => Promise<T>): Promise<T> {
    try { return await fn(); }
    catch (error) { throw new StoreUnavailableError((error as Error).message); }
  }
  list(limit: number) {
    return this.call(async () => {
      const r = await this.pool.query<Row>(
        "SELECT id,task_id,kind,message,created_at,read_at FROM notifications ORDER BY created_at DESC LIMIT $1",
        [limit],
      );
      return r.rows.map((x) => ({
        id: x.id, taskId: x.task_id, kind: x.kind, message: x.message,
        createdAt: x.created_at.toISOString(), readAt: x.read_at?.toISOString() ?? null,
      }));
    });
  }
  markRead(id: string) {
    return this.call(async () => {
      const r = await this.pool.query(
        "UPDATE notifications SET read_at=COALESCE(read_at,now()) WHERE id=$1 RETURNING id",
        [id],
      );
      return Boolean(r.rowCount);
    });
  }
}
