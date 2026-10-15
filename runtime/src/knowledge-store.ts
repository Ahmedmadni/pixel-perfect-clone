import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { KnowledgeCategory, KnowledgeItem } from "../../src/lib/api/types.ts";
import { StoreUnavailableError } from "./store.ts";

export class KnowledgeNotFoundError extends Error {}
export class KnowledgeConflictError extends Error {}

export type KnowledgeDraft = Pick<KnowledgeItem, "category" | "title" | "body" | "tags">;

type ItemRow = {
  id: string; category: KnowledgeCategory; title: string; body: string; tags: string[];
  version: number; updated_at: Date;
};
type VersionRow = { knowledge_id: string; version: number; title: string; body: string; at: Date };

export class PgKnowledgeStore {
  constructor(private readonly pool: Pool) {}

  private async wrap<T>(fn: () => Promise<T>): Promise<T> {
    try { return await fn(); }
    catch (e) {
      if (e instanceof KnowledgeNotFoundError || e instanceof KnowledgeConflictError) throw e;
      throw new StoreUnavailableError((e as Error).message);
    }
  }

  private async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally { client.release(); }
  }

  private async withHistory(rows: ItemRow[]): Promise<KnowledgeItem[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const revisions = await this.pool.query<VersionRow>(
      "SELECT knowledge_id, version, title, body, at FROM knowledge_versions WHERE knowledge_id = ANY($1::uuid[]) ORDER BY version DESC",
      [ids],
    );
    const versions = new Map<string, KnowledgeItem["history"]>();
    for (const r of revisions.rows) {
      const arr = versions.get(r.knowledge_id) ?? [];
      arr.push({ version: r.version, title: r.title, body: r.body, at: r.at.toISOString() });
      versions.set(r.knowledge_id, arr);
    }
    return rows.map((r) => ({
      id: r.id, category: r.category, title: r.title, body: r.body,
      tags: r.tags, version: r.version, updatedAt: r.updated_at.toISOString(),
      history: versions.get(r.id) ?? [],
    }));
  }

  list() {
    return this.wrap(async () => {
      const result = await this.pool.query<ItemRow>(
        "SELECT id, category, title, body, tags, version, updated_at FROM knowledge_items ORDER BY updated_at DESC LIMIT 500",
      );
      return this.withHistory(result.rows);
    });
  }

  get(id: string) {
    return this.wrap(async () => {
      const result = await this.pool.query<ItemRow>(
        "SELECT id, category, title, body, tags, version, updated_at FROM knowledge_items WHERE id=$1", [id],
      );
      if (!result.rows[0]) throw new KnowledgeNotFoundError("knowledge_not_found");
      return (await this.withHistory(result.rows))[0]!;
    });
  }

  create(data: KnowledgeDraft) {
    return this.wrap(async () => {
      const id = randomUUID();
      await this.transaction(async (c) => {
        await c.query(
          "INSERT INTO knowledge_items(id, category, title, body, tags) VALUES($1,$2,$3,$4,$5)",
          [id, data.category, data.title, data.body, data.tags],
        );
        await c.query(
          "INSERT INTO knowledge_versions(knowledge_id, version, category, title, body, tags) VALUES($1,1,$2,$3,$4,$5)",
          [id, data.category, data.title, data.body, data.tags],
        );
        await c.query("INSERT INTO audit_logs(level,actor,message) VALUES('audit','user',$1)", [`Created knowledge item ${id}`]);
      });
      return this.get(id);
    });
  }

  update(id: string, data: KnowledgeDraft, expectedVersion: number) {
    return this.wrap(async () => {
      await this.transaction(async (c) => {
        const locked = await c.query<{ version: number }>(
          "SELECT version FROM knowledge_items WHERE id=$1 FOR UPDATE", [id],
        );
        const current = locked.rows[0];
        if (!current) throw new KnowledgeNotFoundError("knowledge_not_found");
        if (current.version !== expectedVersion) throw new KnowledgeConflictError("version_conflict");
        const nextVersion = current.version + 1;
        await c.query(
          "UPDATE knowledge_items SET category=$2,title=$3,body=$4,tags=$5,version=$6,updated_at=now() WHERE id=$1",
          [id, data.category, data.title, data.body, data.tags, nextVersion],
        );
        await c.query(
          "INSERT INTO knowledge_versions(knowledge_id,version,category,title,body,tags) VALUES($1,$2,$3,$4,$5,$6)",
          [id, nextVersion, data.category, data.title, data.body, data.tags],
        );
        await c.query("INSERT INTO audit_logs(level,actor,message) VALUES('audit','user',$1)", [`Updated knowledge item ${id} to v${nextVersion}`]);
      });
      return this.get(id);
    });
  }

  restore(id: string, version: number, expectedVersion: number) {
    return this.wrap(async () => {
      await this.transaction(async (c) => {
        const locked = await c.query<{ version: number }>(
          "SELECT version FROM knowledge_items WHERE id=$1 FOR UPDATE", [id],
        );
        const current = locked.rows[0];
        if (!current) throw new KnowledgeNotFoundError("knowledge_not_found");
        if (current.version !== expectedVersion) throw new KnowledgeConflictError("version_conflict");
        const revision = await c.query<KnowledgeDraft>(
          "SELECT category, title, body, tags FROM knowledge_versions WHERE knowledge_id=$1 AND version=$2",
          [id, version],
        );
        if (!revision.rows[0]) throw new KnowledgeNotFoundError("knowledge_version_not_found");
        const d = revision.rows[0];
        const next = current.version + 1;
        await c.query(
          "UPDATE knowledge_items SET category=$2,title=$3,body=$4,tags=$5,version=$6,updated_at=now() WHERE id=$1",
          [id,d.category,d.title,d.body,d.tags,next],
        );
        await c.query(
          "INSERT INTO knowledge_versions(knowledge_id,version,category,title,body,tags) VALUES($1,$2,$3,$4,$5,$6)",
          [id,next,d.category,d.title,d.body,d.tags],
        );
        await c.query("INSERT INTO audit_logs(level,actor,message) VALUES('audit','user',$1)", [`Restored knowledge item ${id} from v${version} to v${next}`]);
      });
      return this.get(id);
    });
  }

  remove(id: string) {
    return this.wrap(async () => {
      await this.transaction(async (c) => {
        const result = await c.query("DELETE FROM knowledge_items WHERE id=$1", [id]);
        if (!result.rowCount) throw new KnowledgeNotFoundError("knowledge_not_found");
        // Hard deletion also removes revisions; logs record an ID only, not personal text.
        await c.query("INSERT INTO audit_logs(level,actor,message) VALUES('audit','user',$1)", [`Deleted knowledge item ${id}`]);
      });
      return { ok: true as const };
    });
  }
}
