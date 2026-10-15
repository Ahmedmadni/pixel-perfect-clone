/** Integration test against a real PostgreSQL. Runs only when TEST_DATABASE_URL is set. */
import pg from "pg";
import { describe, expect, it } from "vitest";
import { migrate } from "../src/migrate.ts";
import { PgControlStore } from "../src/store.ts";

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
});
