import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { StoreUnavailableError } from "./store.ts";

export class PermissionConflictError extends Error {}
export class PermissionNotFoundError extends Error {}
export type DomainPermission = {
  id: string;
  domain: string;
  label: string;
  canReview: boolean;
  canExternalWrite: false;
  createdAt: string;
};
export interface PermissionRepository {
  list(): Promise<DomainPermission[]>;
  create(input: { domain: string; label: string }): Promise<DomainPermission>;
  setReview(id: string, allowed: boolean): Promise<DomainPermission>;
  isAllowed(url: string): Promise<boolean>;
}
type Row = {id: string; domain: string; label: string; can_review: boolean; created_at: Date};
const commonSuffixes = new Set(["com","net","org","co.uk","gov","edu","sa","com.sa"]);
export function normalizeDomain(raw: string): string {
  const text = raw.trim().toLowerCase().replace(/\.$/,"");
  if (commonSuffixes.has(text) ||
      !/^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(text) ||
      text.includes("..")) throw new PermissionConflictError("invalid_domain");
  return text;
}
function toRecord(row: Row): DomainPermission {
  return {
    id: row.id, domain: row.domain, label: row.label, canReview: row.can_review,
    canExternalWrite: false, createdAt: row.created_at.toISOString(),
  };
}
export class PgPermissionRepository implements PermissionRepository {
  constructor(private readonly pool: Pool) {}
  private async execute<T>(fn: () => Promise<T>): Promise<T> {
    try { return await fn(); }
    catch (e) {
      if(e instanceof PermissionConflictError || e instanceof PermissionNotFoundError) throw e;
      throw new StoreUnavailableError((e as Error).message);
    }
  }
  list() {
    return this.execute(async () => {
      const r = await this.pool.query<Row>(
        "SELECT id,domain,label,can_review,created_at FROM review_permissions ORDER BY label LIMIT 300",
      );
      return r.rows.map(toRecord);
    });
  }
  create(input: {domain:string; label:string}) {
    return this.execute(async () => {
      const domain=normalizeDomain(input.domain);
      const duplicate = await this.pool.query<Row>("SELECT id FROM review_permissions WHERE domain=$1",[domain]);
      if(duplicate.rowCount) throw new PermissionConflictError("domain_already_registered");
      const rows = await this.pool.query<Row>(
        "INSERT INTO review_permissions(id,domain,label,can_review) VALUES($1,$2,$3,false) RETURNING id,domain,label,can_review,created_at",
        [randomUUID(),domain,input.label],
      );
      return toRecord(rows.rows[0]!);
    });
  }
  setReview(id:string,allowed:boolean) {
    return this.execute(async () => {
      const r=await this.pool.query<Row>(
        "UPDATE review_permissions SET can_review=$2,updated_at=now() WHERE id=$1 RETURNING id,domain,label,can_review,created_at",
        [id,allowed],
      );
      if(!r.rows[0]) throw new PermissionNotFoundError("domain_permission_not_found");
      return toRecord(r.rows[0]);
    });
  }
  isAllowed(url:string) {
    return this.execute(async () => {
      let parsed:URL;
      try { parsed=new URL(url); }
      catch { return false; }
      if (parsed.protocol !== "https:" || parsed.username || parsed.password) return false;
      const host=parsed.hostname.toLowerCase().replace(/\.$/,"");
      const r=await this.pool.query<{domain:string}>("SELECT domain FROM review_permissions WHERE can_review=true");
      return r.rows.some((x)=>host===x.domain || host.endsWith("."+x.domain));
    });
  }
}
