import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { ChatMessage, ChatMessageStatus } from "../../src/lib/api/types.ts";
import { StoreUnavailableError } from "./store.ts";

export interface ChatStore {
  /** Newest-last page of messages; `before` is a message seq cursor. */
  list(conversationId: string, limit: number, before?: number): Promise<{ messages: ChatMessage[]; nextBefore: number | null }>;
  /** Only complete messages — what is sent to the model as context. */
  context(conversationId: string, limit: number): Promise<ChatMessage[]>;
  addUser(conversationId: string, content: string): Promise<ChatMessage>;
  startAssistant(conversationId: string, model: string): Promise<ChatMessage>;
  finishAssistant(id: string, content: string, status: Exclude<ChatMessageStatus, "streaming">, error?: string): Promise<ChatMessage>;
  /** Startup recovery: any 'streaming' row left by a crash becomes 'failed'. */
  recover(): Promise<void>;
}

type Row = {
  id: string; seq: string; role: ChatMessage["role"]; content: string; status: ChatMessageStatus;
  model: string | null; error: string | null; created_at: Date;
};
const toMsg = (r: Row): ChatMessage => ({
  id: r.id, seq: Number(r.seq), role: r.role, content: r.content, status: r.status,
  model: r.model, error: r.error, at: r.created_at.toISOString(),
});
const COLS = "id, seq::text, role, content, status, model, error, created_at";

export class PgChatStore implements ChatStore {
  constructor(private pool: Pool) {}
  private async q<T>(fn: () => Promise<T>) {
    try {
      return await fn();
    } catch (e) {
      throw new StoreUnavailableError((e as Error).message);
    }
  }
  list(conv: string, limit: number, before?: number) {
    return this.q(async () => {
      const r = await this.pool.query<Row>(
        `SELECT ${COLS} FROM chat_messages WHERE conversation_id=$1 AND ($2::bigint IS NULL OR seq < $2)
         ORDER BY seq DESC LIMIT $3`,
        [conv, before ?? null, limit + 1],
      );
      const more = r.rows.length > limit;
      const rows = r.rows.slice(0, limit);
      return { messages: rows.reverse().map(toMsg), nextBefore: more ? Number(rows[0]!.seq) : null };
    });
  }
  context(conv: string, limit: number) {
    return this.q(async () => {
      const r = await this.pool.query<Row>(
        `SELECT ${COLS} FROM chat_messages WHERE conversation_id=$1 AND status='complete' AND content <> ''
         ORDER BY seq DESC LIMIT $2`,
        [conv, limit],
      );
      return r.rows.reverse().map(toMsg);
    });
  }
  addUser(conv: string, content: string) {
    return this.q(async () => {
      const r = await this.pool.query<Row>(
        `INSERT INTO chat_messages (id, conversation_id, role, content, status) VALUES ($1,$2,'user',$3,'complete') RETURNING ${COLS}`,
        [randomUUID(), conv, content],
      );
      return toMsg(r.rows[0]!);
    });
  }
  startAssistant(conv: string, model: string) {
    return this.q(async () => {
      const r = await this.pool.query<Row>(
        `INSERT INTO chat_messages (id, conversation_id, role, content, status, model) VALUES ($1,$2,'assistant','','streaming',$3) RETURNING ${COLS}`,
        [randomUUID(), conv, model],
      );
      return toMsg(r.rows[0]!);
    });
  }
  finishAssistant(id: string, content: string, status: Exclude<ChatMessageStatus, "streaming">, error?: string) {
    return this.q(async () => {
      const r = await this.pool.query<Row>(
        `UPDATE chat_messages SET content=$2, status=$3, error=$4, updated_at=now() WHERE id=$1 RETURNING ${COLS}`,
        [id, content, status, error ?? null],
      );
      return toMsg(r.rows[0]!);
    });
  }
  recover() {
    return this.q(async () => {
      await this.pool.query(
        "UPDATE chat_messages SET status='failed', error='runtime restarted mid-stream', updated_at=now() WHERE status='streaming'",
      );
    });
  }
}
