/** Optional PostgreSQL test; TEST_DATABASE_URL MUST point to a disposable database. */
import pg from "pg";
import { describe, expect, it } from "vitest";
import { migrate } from "../src/migrate.ts";
import { PgPermissionRepository, PermissionConflictError } from "../src/review-permissions.ts";

const database = process.env["TEST_DATABASE_URL"];
describe.skipIf(!database)("real PostgreSQL deny-by-default review domains", () => {
  it("requires opt-in, matches approved subdomains only and forbids enabling external writes", async () => {
    await migrate(database!);
    const pool = new pg.Pool({ connectionString:database! });
    try {
      const permissions = new PgPermissionRepository(pool);
      const domain = "review-" + Date.now() + ".example.org";
      const saved = await permissions.create({domain,label:"Temporary test domain"});
      expect(saved.canReview).toBe(false);
      expect(await permissions.isAllowed("https://" + domain + "/")).toBe(false);
      await expect(permissions.create({domain,label:"duplicate"}))
        .rejects.toBeInstanceOf(PermissionConflictError);
      const updated = await permissions.setReview(saved.id,true);
      expect(updated.canReview).toBe(true);
      expect(await permissions.isAllowed("https://sub." + domain + "/")).toBe(true);
      expect(await permissions.isAllowed("https://fake" + domain + "/")).toBe(false);
      expect(await permissions.isAllowed("http://" + domain + "/")).toBe(false);
      await expect(pool.query("UPDATE review_permissions SET can_external_write=true WHERE id=$1",[saved.id]))
        .rejects.toThrow(/check constraint/i);
      await permissions.setReview(saved.id,false);
      expect(await permissions.isAllowed("https://" + domain + "/")).toBe(false);
    } finally { await pool.end(); }
  });
});
