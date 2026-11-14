import { platforms, type PlatformId, type SourceTask } from "../../contracts/src/index.js";

function dateLabel(value: SourceTask["deadline"]) {
  if (value.kind === "none") return "不限";
  if (value.kind !== "known") return "待确认";
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(value.value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}`;
}
export function taskNotice(task: Pick<SourceTask, "title" | "course" | "type" | "startTime" | "deadline"> & { platform?: PlatformId },
  kind: "new" | "deadline" | "reminder" | "change", simulated = false) {
  const activity = task.type === 'activity';
  const label = kind === "new" ? activity ? '新活动' : task.type === "homework" ? "新作业" : task.type === "exam" ? "新考试" : "新任务"
    : kind === "deadline" ? activity ? '活动开始' : "截止通知" : kind === "reminder" ? activity ? '活动开始提醒' : "截止提醒" : activity ? '活动信息变更' : "任务信息变更";
  return {
    title: `${simulated ? "【模拟】" : ""}${task.platform ? `${platforms[task.platform].short} · ` : ""}${label} · ${task.course || "课程待确认"}`,
    body: `${task.platform ? `平台：${platforms[task.platform].name}\n` : ""}名称：${task.title}\n${activity ? `活动开始：${dateLabel(task.startTime)}` : `开始：${dateLabel(task.startTime)}\n截止：${dateLabel(task.deadline)}`}`,
  };
}
