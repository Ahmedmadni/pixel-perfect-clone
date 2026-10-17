import type { ActivityLog, AgentTask, TaskStatus } from "./api/types";

/** Pure view helpers: never mutate tasks, write to APIs, or imply that mock data is real. */
export const TASK_STATES: readonly TaskStatus[] = [
  "queued", "running", "awaiting_approval", "done", "failed", "cancelled",
] as const;

export const TASK_LABELS: Record<TaskStatus, string> = {
  queued: "في الانتظار",
  running: "قيد التنفيذ",
  awaiting_approval: "بانتظار موافقة",
  done: "مكتملة",
  failed: "فشلت",
  cancelled: "ملغاة",
};

export type TaskFilter = TaskStatus | "all";
export type LogFilter = ActivityLog["level"] | "all";

export function summarizeTasks(tasks: readonly AgentTask[]) {
  const count: Record<TaskStatus, number> = {
    queued: 0, running: 0, awaiting_approval: 0, done: 0, failed: 0, cancelled: 0,
  };
  for (const task of tasks) count[task.status]++;
  return {
    total: tasks.length,
    ...count,
    pending: count.queued + count.running + count.awaiting_approval,
  };
}

function queryMatches(value: string, query: string) {
  return value.toLocaleLowerCase("ar").includes(query.trim().toLocaleLowerCase("ar"));
}

export function filterTasks(tasks: readonly AgentTask[], status: TaskFilter, search: string): AgentTask[] {
  const q = search.trim();
  return tasks
    .filter((t) => (status === "all" || t.status === status) &&
      (!q || queryMatches([t.title, t.objective ?? "", t.status, TASK_LABELS[t.status]].join(" "), q)))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export function filterLogs(logs: readonly ActivityLog[], level: LogFilter, search: string): ActivityLog[] {
  const q = search.trim();
  return logs
    .filter((l) => (level === "all" || l.level === level) &&
      (!q || queryMatches([l.message, l.actor, l.level].join(" "), q)))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}
