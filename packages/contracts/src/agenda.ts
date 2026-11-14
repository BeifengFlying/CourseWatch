import type { Task, Schedule } from "./index.js";
export interface AgendaEntry {
  id: string;
  title: string;
  subtitle: string;
  dueAt: number | null;
  done: boolean;
  important: boolean;
  local: boolean;
  reminderHours?: number[] | null;
  task?: Task;
  schedule?: Schedule;
}
export const taskDone = (t: Task) =>
  t.personalDone ||
  ["submitted", "graded", "cancelled"].includes(t.sourceStatus);
export function agendaEntries(
  tasks: Task[],
  schedules: Schedule[],
): AgendaEntry[] {
  return [
    ...tasks.map((t) => ({
      id: t.id,
      title: t.title,
      subtitle: t.course,
      dueAt: t.deadline.kind === "known" ? t.deadline.value : null,
      done: taskDone(t),
      important: !!t.important,
      local: false,
      reminderHours: t.reminderHours,
      task: t,
    })),
    ...schedules.map((s) => ({
      id: s.id,
      title: s.title,
      subtitle: s.note || "个人日程",
      dueAt: s.dueAt,
      done: s.done,
      important: s.important,
      local: true,
      reminderHours: s.reminderHours,
      schedule: s,
    })),
  ];
}
export function priorityGroup(t: AgendaEntry, now: number) {
  if (t.done) return 5;
  if (t.dueAt !== null && t.dueAt >= now && t.dueAt - now <= 24 * 3600000)
    return 0;
  if (t.important) return 1;
  if (t.dueAt !== null && t.dueAt >= now) return 2;
  if (t.dueAt !== null) return 3;
  return 4;
}
export function sortAgenda(items: AgendaEntry[], now = Date.now()) {
  return [...items].sort(
    (a, b) =>
      priorityGroup(a, now) - priorityGroup(b, now) ||
      (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity) ||
      a.title.localeCompare(b.title, "zh-CN") ||
      a.id.localeCompare(b.id),
  );
}
export function reminderLabel(hours: number[]) {
  return [...new Set(hours)]
    .sort((a, b) => b - a)
    .map((h) =>
      h >= 24 && h % 24 === 0
        ? `${h / 24} 天`
        : h >= 1 && Number.isInteger(h)
          ? `${h} 小时`
          : `${Math.round(h * 60)} 分钟`,
    )
    .join("、");
}
