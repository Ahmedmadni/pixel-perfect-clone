import { describe, expect, it } from "vitest";
import { filterLogs, filterTasks, summarizeTasks, TASK_STATES } from "./activity-view";
import type { AgentTask, ActivityLog } from "./api/types";

const tasks: AgentTask[] = [
  { id:"t1",title:"مراجعة الرسائل التجريبية",objective:"مراجعة محتوى الصفحة",status:"running",createdAt:"2026-10-16T10:00:00Z" },
  { id:"t2",title:"تلخيص غير حقيقي",status:"done",createdAt:"2026-10-17T10:00:00Z" },
  { id:"t3",title:"مهمة تحتاج موافقة",status:"awaiting_approval",createdAt:"2026-10-15T10:00:00Z" },
  { id:"t4",title:"انتظار",status:"queued",createdAt:"2026-10-14T10:00:00Z" },
];
const logs:ActivityLog[] = [
  {id:"l1",level:"warn",actor:"system",message:"لا تتصل بالخادم",at:"2026-10-14T12:00:00Z"},
  {id:"l2",level:"audit",actor:"user",message:"تمت المراجعة",at:"2026-10-17T12:00:00Z"},
];

describe("read-only task center selectors", () => {
  it("summarizes each task state and pending categories without miscounting", () => {
    expect(summarizeTasks(tasks)).toMatchObject({total:4,running:1,done:1,awaiting_approval:1,queued:1,pending:3,failed:0});
    expect(TASK_STATES).toHaveLength(6);
  });
  it("does not mutate caller records and returns tasks sorted newest first", () => {
    expect(filterTasks(tasks,"all","").map(x=>x.id)).toEqual(["t2","t1","t3","t4"]);
    expect(tasks.map(x=>x.id)).toEqual(["t1","t2","t3","t4"]);
  });
  it("filters status and Arabic search even when case or whitespace differs", () => {
    expect(filterTasks(tasks,"running","مُتعذر")).toHaveLength(0);
    expect(filterTasks(tasks,"running","  الرسائل  ").map(x=>x.id)).toEqual(["t1"]);
    expect(filterTasks(tasks,"awaiting_approval","موافقة").map(x=>x.id)).toEqual(["t3"]);
    expect(filterTasks(tasks,"failed","")).toEqual([]);
  });
  it("filters logs by severity and text and sorts newest first", () => {
    expect(filterLogs(logs,"all","").map(x=>x.id)).toEqual(["l2","l1"]);
    expect(filterLogs(logs,"warn","الخادم").map(x=>x.id)).toEqual(["l1"]);
    expect(filterLogs(logs,"audit","غير موجود")).toEqual([]);
    expect(logs[0]?.id).toBe("l1");
  });
  it("handles empty streams without fabricated counts", () => {
    expect(summarizeTasks([]).pending).toBe(0);
    expect(filterTasks([],"all","")).toEqual([]);
    expect(filterLogs([],"all","")).toEqual([]);
  });
});
