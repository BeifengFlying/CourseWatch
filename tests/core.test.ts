import { beforeEach, afterEach, describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../packages/storage/src/index.js";
import { Engine } from "../packages/core/src/index.js";
import {
  ScanResult,
  type SourceTask,
} from "../packages/contracts/src/index.js";
let dir: string, store: Store, engine: Engine;
const accountId = randomUUID();
const now = 1800000000000;
const task = (overrides: Partial<SourceTask> = {}): SourceTask => ({
  sourceId: "1",
  namespace: "class:one:homework",
  title: "作业",
  course: "课程",
  type: "homework",
  sourceStatus: "pending",
  deadline: {
    kind: "known",
    value: now + 5 * 3600000,
    raw: "test",
    timezone: "Asia/Shanghai",
  },
  startTime: { kind: "unknown" },
  publishTime: { kind: "unknown" },
  ...overrides,
});
const scan = (
  items: SourceTask[],
  outcome: "complete" | "partial" = "complete",
) => ({
  platform: "ynjy",
  accountId,
  outcome,
  discoveryComplete: outcome === "complete",
  partitions: [
    {
      key: "one",
      outcome,
      paginationComplete: outcome === "complete",
      emptyConfirmed: !items.length,
      items,
      issues: [],
    },
  ],
  issues: [],
});
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cw-core-"));
  store = new Store(join(dir, "test.db"));
  engine = new Engine(store);
});
afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});
describe("任务一致性与提醒", () => {
  it("建立基线，重复快照不重复历史或通知，之后新增只通知一次", () => {
    engine.apply(scan([task()]), now);
    expect(store.all("SELECT * FROM outbox WHERE kind='new'")).toHaveLength(0);
    engine.apply(scan([task()]), now + 1);
    expect(store.all("SELECT * FROM history")).toHaveLength(1);
    engine.apply(scan([task(), task({ sourceId: "2" })]), now + 2);
    engine.apply(scan([task(), task({ sourceId: "2" })]), now + 3);
    expect(store.all("SELECT * FROM outbox WHERE kind='new'")).toHaveLength(1);
  });
  it("有效的部分快照建立配置页面基线，之后可发现新条目", () => {
    engine.apply(scan([task()], "partial"), now);
    engine.apply(scan([task(), task({ sourceId: "2" })], "partial"), now + 1);
    expect(store.all("SELECT * FROM outbox WHERE kind='new'")).toHaveLength(1);
  });
  it("截止变更提升版本并替换旧计划；等价文本时间不产生变化", () => {
    engine.apply(scan([task()]), now);
    const changed = task({
      deadline: {
        kind: "known",
        value: now + 6 * 3600000,
        raw: "later",
        timezone: "Asia/Shanghai",
      },
    });
    engine.apply(scan([changed]), now + 1);
    expect(engine.tasks()[0].deadlineVersion).toBe(2);
    expect(
      store
        .all<any>("SELECT * FROM reminders")
        .every((r) => r.deadline_version === 2),
    ).toBe(true);
    engine.apply(
      scan([
        task({
          ...changed,
          deadline: { ...changed.deadline, raw: "same time" } as any,
        }),
      ]),
      now + 2,
    );
    expect(store.all("SELECT * FROM history")).toHaveLength(2);
  });
  it("失败、部分和登录失效均不删除旧任务，未知字段不覆盖可信值", () => {
    engine.apply(scan([task()]), now);
    engine.apply(
      {
        platform: "ynjy",
        accountId,
        outcome: "failed",
        discoveryComplete: false,
        partitions: [],
        issues: ["network"],
      },
      now + 1,
    );
    engine.apply(scan([], "partial"), now + 2);
    engine.apply(
      scan(
        [task({ deadline: { kind: "unknown" }, sourceStatus: "unknown" })],
        "partial",
      ),
      now + 3,
    );
    expect(engine.tasks()).toHaveLength(1);
    expect(engine.tasks()[0].deadline.kind).toBe("known");
    expect(engine.tasks()[0].sourceStatus).toBe("pending");
    expect(engine.tasks()[0].needsReview).toBe(false);
  });
  it("完整快照中缺失仅标为待核实，绝不自动撤回", () => {
    engine.apply(scan([task()]), now);
    engine.apply(scan([]), now + 1);
    expect(engine.tasks()[0].needsReview).toBe(true);
    expect(engine.tasks()[0].sourceStatus).toBe("pending");
  });
  it("跨课程与跨账号重号任务独立存储", () => {
    engine.apply(
      scan([task(), task({ namespace: "class:two:homework" })]),
      now,
    );
    engine.apply({ ...scan([task()]), accountId: randomUUID() }, now);
    expect(engine.tasks()).toHaveLength(3);
  });
  it("个人完成不修改来源状态，并停止截止提醒", () => {
    engine.apply(scan([task()]), now);
    engine.markDone(engine.tasks()[0].id, true);
    expect(engine.tasks()[0].sourceStatus).toBe("pending");
    expect(store.all("SELECT * FROM reminders")).toHaveLength(0);
  });
  it("休眠补算合并提醒且重启后不重复发送", () => {
    engine.apply(scan([task()]), now);
    engine.reminders(now + 6 * 3600000);
    expect(
      store.all("SELECT * FROM outbox WHERE kind='deadline'"),
    ).toHaveLength(1);
    store.close();
    store = new Store(join(dir, "test.db"));
    engine = new Engine(store);
    engine.reminders(now + 7 * 3600000);
    engine.apply(scan([task()]), now + 7 * 3600000);
    engine.reminders(now + 7 * 3600000);
    expect(
      store.all("SELECT * FROM outbox WHERE kind='deadline'"),
    ).toHaveLength(1);
  });
  it("未知截止不生成提醒", () => {
    engine.apply(scan([task({ deadline: { kind: "unknown" } })]), now);
    expect(store.all("SELECT * FROM reminders")).toHaveLength(0);
  });
  it("缺少完整性证据与失败扫描夹带数据均被拒绝", () => {
    expect(() => ScanResult.parse({ ...scan([]), partitions: [] })).toThrow();
    expect(() =>
      engine.apply({ ...scan([task()]), outcome: "failed" }),
    ).toThrow();
    expect(engine.tasks()).toHaveLength(0);
  });
  it("数据库一致性备份可恢复任务和历史", async () => {
    engine.apply(scan([task()]), now);
    const file = join(dir, "backup.db");
    await store.backup(file);
    const restored = new Store(file);
    expect(new Engine(restored).tasks()).toHaveLength(1);
    expect(restored.all("SELECT * FROM history")).toHaveLength(1);
    restored.close();
  });
});
it("截止变更或个人完成使尚未发送的旧截止通知失效", () => {
  engine.apply(scan([task()]), now);
  engine.reminders(now);
  expect(
    store.all(
      "SELECT * FROM outbox WHERE kind='deadline' AND delivered_at IS NULL",
    ),
  ).toHaveLength(1);
  engine.apply(
    scan([
      task({
        deadline: {
          kind: "known",
          value: now + 10 * 3600000,
          raw: "changed",
          timezone: "Asia/Shanghai",
        },
      }),
    ]),
    now + 1,
  );
  expect(
    store.all(
      "SELECT * FROM outbox WHERE kind='deadline' AND delivered_at IS NULL",
    ),
  ).toHaveLength(0);
  engine.reminders(now + 2);
  engine.markDone(engine.tasks()[0].id, true);
  expect(
    store.all(
      "SELECT * FROM outbox WHERE kind='deadline' AND delivered_at IS NULL",
    ),
  ).toHaveLength(0);
});
it("跨分区返回同一来源条目时只保留一次发现和稳定任务 ID", () => {
  const s = scan([task()]);
  s.partitions.push({ ...s.partitions[0], key: "overlap" });
  engine.apply(s, now);
  expect(engine.tasks()).toHaveLength(1);
  expect(store.all("SELECT * FROM history")).toHaveLength(1);
});
it("单项自定义分钟提醒在重新同步后保留，不影响其他任务", () => {
  engine.apply(scan([task(), task({ sourceId: "2" })]), now);
  const t = engine.tasks()[0];
  engine.updateTask(t.id, { important: true, reminderHours: [10 / 60, 0.5] });
  engine.apply(scan([task(), task({ sourceId: "2" })]), now + 1);
  expect(engine.tasks().find((v) => v.id === t.id)).toMatchObject({
    important: true,
    reminderHours: [10 / 60, 0.5],
  });
  const rules = store
    .all<{ rule_hours: number }>(
      "SELECT rule_hours FROM reminders WHERE task_id=?",
      t.id,
    )
    .map((r) => r.rule_hours)
    .sort((a, b) => a - b);
  expect(rules).toEqual([0, 10 / 60, 0.5]);
  engine.reminders(now + 4.5 * 3600000);
  expect(
    store.all("SELECT * FROM outbox WHERE kind='deadline' AND task_id=?", t.id),
  ).toHaveLength(1);
});
it("日程到期、完成、改期与删除均更新持久提醒，休眠补发只保留一次", () => {
  const s = {
    id: randomUUID(),
    title: "汇报",
    note: "带电脑",
    dueAt: now + 3600000,
    important: true,
    reminderHours: [0.5],
    done: false,
    version: 1,
    updatedAt: now,
  };
  engine.saveSchedule(s);
  engine.reminders(now + 31 * 60000);
  expect(store.all("SELECT * FROM outbox WHERE task_id=?", s.id)).toHaveLength(
    1,
  );
  engine.saveSchedule({ ...s, dueAt: now + 2 * 3600000, version: 2 });
  expect(
    store.all(
      "SELECT * FROM outbox WHERE task_id=? AND delivered_at IS NULL",
      s.id,
    ),
  ).toHaveLength(0);
  engine.reminders(now + 3 * 3600000);
  engine.reminders(now + 4 * 3600000);
  expect(
    store.all(
      "SELECT * FROM outbox WHERE task_id=? AND delivered_at IS NULL",
      s.id,
    ),
  ).toHaveLength(1);
  engine.saveSchedule({ ...s, done: true, version: 2 });
  expect(
    store.all("SELECT * FROM reminders WHERE task_id=?", s.id),
  ).toHaveLength(0);
  expect(engine.deleteSchedule(s.id)).toBe(true);
  expect(engine.schedules()).toHaveLength(0);
});

it('新作业与截止通知均包含平台、课程、名称及北京时间起止日期',()=>{
 const start={kind:'known' as const,value:Date.parse('2026-11-12T00:00:00Z'),raw:'test',timezone:'Asia/Shanghai' as const};
 engine.apply(scan([task({startTime:start})]),now);
 engine.apply(scan([task({startTime:start}),task({sourceId:'notice-new',title:'通知样例',course:'测试课程',startTime:start})]),now+1);
 const added=store.all<any>("SELECT * FROM outbox WHERE kind='new'")[0];
 expect(added.title).toBe('云南省高等学校计算机等级考试系统 · 新作业 · 测试课程');expect(added.body).toContain('名称：通知样例');expect(added.body).toContain('开始：2026-11-12 08:00');expect(added.body).toMatch(/截止：20\d{2}-\d{2}-\d{2} \d{2}:\d{2}/);
 engine.reminders(now+6*3600000);
 const ended=store.all<any>("SELECT * FROM outbox WHERE kind='deadline' AND task_id=?",engine.tasks().find(t=>t.sourceId==='notice-new')!.id)[0];
 expect(ended.title).toBe('云南省高等学校计算机等级考试系统 · 截止通知 · 测试课程');expect(ended.body).toBe(added.body);
});

it('首次读取已截止任务不计划提醒，重复扫描和修改提醒设置也不补发', () => {
  const expired = task({ deadline: { kind: 'known', value: now - 1, raw: 'past', timezone: 'Asia/Shanghai' } });
  engine.apply(scan([expired]), now);
  const t = engine.tasks()[0];
  engine.updateTask(t.id, { reminderHours: [1] });
  engine.apply(scan([expired]), now + 10);
  engine.reminders(now + 100);
  expect(store.all("SELECT * FROM reminders")).toHaveLength(0);
  expect(store.all("SELECT * FROM outbox WHERE kind='deadline'")).toHaveLength(0);
  engine.apply(scan([task()]), now + 100);
  expect(store.all("SELECT * FROM reminders").length).toBeGreaterThan(0);
});

it('课程先待选择，同名课程分开；移除停止提醒，重新添加恢复记录，扫描不撤销选择', () => {
  const input = { ...scan([task({ courseKey: 'classroom:a' }), task({ sourceId: '2', courseKey: 'classroom:b' })]), platform: 'yuketang', courses: [{ key: 'classroom:a', name: '课程' }, { key: 'classroom:b', name: '课程' }, { key: 'classroom:empty', name: '空课程' }] };
  engine.apply(input, now);
  expect(engine.courses()).toHaveLength(3);
  expect(engine.visibleTasks()).toHaveLength(0);
  expect(store.all('SELECT * FROM reminders')).toHaveLength(0);
  const chosen = engine.courses().find(c => c.key === 'classroom:a')!;
  expect(engine.selectCourses('yuketang', accountId, ['foreign'])).toBe(false);
  engine.selectCourses('yuketang', accountId, [chosen.id], now);
  expect(engine.visibleTasks()).toHaveLength(1);
  const id = engine.visibleTasks()[0].id;
  engine.updateTask(id, { important: true });
  engine.reminders(now);
  engine.selectCourses('yuketang', accountId, [], now);
  expect(engine.visibleTasks()).toHaveLength(0);
  expect(store.all("SELECT * FROM outbox WHERE kind='deadline' AND delivered_at IS NULL")).toHaveLength(0);
  engine.apply(input, now + 1);
  expect(engine.courses().every(c => c.status === 'removed')).toBe(true);
  engine.selectCourses('yuketang', accountId, [chosen.id], now + 2);
  expect(engine.visibleTasks()[0]).toMatchObject({ id, important: true });
  expect(engine.tasks()).toHaveLength(2);
  store.close(); store = new Store(join(dir, 'test.db')); engine = new Engine(store);
  expect(engine.visibleTasks()[0].id).toBe(id);
});

it('课程选择前已经截止的任务以及重新添加时已截止的任务不补发提醒', () => {
  engine.apply({ ...scan([task({courseKey:'a'})]), platform:'yuketang' }, now);
  const c = engine.courses()[0];
  engine.selectCourses('yuketang',accountId,[c.id],now + 6 * 3600000);
  engine.reminders(now + 6 * 3600000);
  expect(store.all("SELECT * FROM outbox WHERE kind='deadline'")).toHaveLength(0);
});
