import { it, expect } from "vitest";
import { agendaEntries, sortAgenda } from "../packages/contracts/src/agenda.js";
import type { Schedule } from "../packages/contracts/src/index.js";
const now = 1800000000000;
const schedule = (
  id: string,
  hours: number,
  extra: Partial<Schedule> = {},
): Schedule => ({
  id,
  title: id,
  note: "",
  dueAt: now + hours * 3600000,
  done: false,
  important: false,
  reminderHours: null,
  version: 1,
  updatedAt: now,
  ...extra,
});
it("临近截止先于远期重要事项，过期和完成事项不会挤掉近期任务", () => {
  const items = agendaEntries(
    [],
    [
      schedule("过期", -2),
      schedule("完成", 1, { done: true }),
      schedule("重要", 100, { important: true }),
      schedule("明天", 30),
      schedule("临近", 2),
    ],
  );
  expect(sortAgenda(items, now).map((t) => t.id)).toEqual([
    "临近",
    "重要",
    "明天",
    "过期",
    "完成",
  ]);
  expect(
    sortAgenda(items, now + 3 * 3600000).findIndex((t) => t.id === "临近"),
  ).toBeGreaterThan(0);
});
