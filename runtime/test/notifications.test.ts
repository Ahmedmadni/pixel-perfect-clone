import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app.ts";
import type { ControlStore } from "../src/store.ts";
import type { LocalNotification, NotificationRepository } from "../src/notification-store.ts";
import { initialControl } from "../../src/lib/control-machine.ts";

const TOKEN = "n".repeat(64);
const cfg = { RUNTIME_TOKEN: TOKEN, CORS_ORIGINS: ["http://localhost:8080"] };
const auth = { authorization: `Bearer ${TOKEN}` };
function controls(): ControlStore {
  return {
    ping: async () => {},
    getSnapshot: async () => initialControl,
    apply: async () => ({ ok:false, snapshot: initialControl }),
    logs: async () => [],
  };
}
function notifications(): NotificationRepository {
  const row: LocalNotification = {
    id: randomUUID(), taskId: randomUUID(), kind:"task_done",
    message: "اكتملت مهمة مراجعة محلية",createdAt:new Date().toISOString(),readAt:null,
  };
  return {
    list: async () => [row],
    markRead: async (id) => {
      if(id!==row.id) return false;
      row.readAt = new Date().toISOString(); return true;
    },
  };
}

describe("private in-app notification inbox", () => {
  it("requires local bearer auth",async ()=>{
    const app=await buildApp(cfg, controls(), {notifications:notifications()});
    expect((await app.inject({url:"/v1/notifications"})).statusCode).toBe(401);
    await app.close();
  });
  it("reports that notifications are unavailable without a DB store",async ()=>{
    const app=await buildApp(cfg,controls());
    expect((await app.inject({url:"/v1/notifications",headers:auth})).statusCode).toBe(503);
    await app.close();
  });
  it("lists only minimal task status text and marks a notice read",async ()=>{
    const app=await buildApp(cfg,controls(),{notifications:notifications()});
    const r=await app.inject({url:"/v1/notifications",headers:auth});
    expect(r.statusCode).toBe(200);
    const notice=r.json()[0] as LocalNotification;
    expect(notice.kind).toBe("task_done");
    expect(notice.message).not.toContain("http");
    expect(notice.readAt).toBeNull();
    const mark=await app.inject({method:"POST",url:`/v1/notifications/${notice.id}/read`,headers:auth,payload:{}});
    expect(mark.statusCode).toBe(200);
    expect((await app.inject({url:"/v1/notifications",headers:auth})).json()[0].readAt).not.toBeNull();
    await app.close();
  });
  it("rejects foreign origins and malformed IDs",async ()=>{
    const app=await buildApp(cfg,controls(),{notifications:notifications()});
    expect((await app.inject({url:"/v1/notifications",headers:{...auth,origin:"https://attacker.example"}})).statusCode).toBe(403);
    expect((await app.inject({method:"POST",url:"/v1/notifications/not-a-uuid/read",headers:auth,payload:{}})).statusCode).toBe(400);
    await app.close();
  });
});
