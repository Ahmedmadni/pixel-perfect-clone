/** Integration test against a real PostgreSQL. Runs only when TEST_DATABASE_URL is set. */
import pg from "pg";
import { describe, expect, it } from "vitest";
import { migrate } from "../src/migrate.ts";
import { PgControlStore } from "../src/store.ts";
import { PgTaskRepository } from "../src/task-store.ts";
import { PgNotificationRepository } from "../src/notification-store.ts";

const url = process.env["TEST_DATABASE_URL"];
describe.skipIf(!url)("PgControlStore (real postgres)", () => {
  it("persists transitions, serializes races, resets on startup, audit is append-only", async () => {
    await migrate(url!);
    const pool = new pg.Pool({ connectionString: url });
    await pool.query("UPDATE control_state SET state='AGENT_ACTIVE' WHERE id=1");
    const store = new PgControlStore(pool);
    expect((await store.getSnapshot()).state).toBe("STOPPED"); // startup safety reset
    expect((await store.apply({ type: "RESET" }, "user")).ok).toBe(true);
    // Race: two START_AGENT at once — exactly one may win.
    const rs = await Promise.all([store.apply({ type: "START_AGENT" }, "user"), store.apply({ type: "START_AGENT" }, "user")]);
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
    await expect(pool.query("DELETE FROM audit_logs")).rejects.toThrow(/append-only/);
    expect((await store.logs(10)).length).toBeGreaterThan(0);
    await pool.end();
  });
  it("commits one privacy-minimal notification for a completed review", async () => {
    await migrate(url!);
    const pool = new pg.Pool({ connectionString: url });
    try {
      const tasks = new PgTaskRepository(pool);
      const inbox = new PgNotificationRepository(pool);
      const id = "b334ff99-4f63-41a2-84b6-3f0c655102f1";
      const task = await tasks.create({ objective:"Review this approved example tab",
        tabId: id, model:"local-test" });
      await tasks.begin(task.id);
      await tasks.finish(task.id,"done","Read-only summary generated");
      expect((await tasks.get(task.id))?.status).toBe("done");
      const events = await inbox.list(100);
      const notice = events.find((n) => n.taskId === task.id);
      expect(notice?.kind).toBe("task_done");
      expect(notice?.message).not.toContain("Read-only summary generated");
      expect(notice?.readAt).toBeNull();
      expect(await inbox.markRead(notice!.id)).toBe(true);
      expect((await inbox.list(100)).find((n) => n.id === notice!.id)?.readAt).not.toBeNull();
    } finally { await pool.end(); }
  });

});
