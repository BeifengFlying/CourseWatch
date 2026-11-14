import { randomUUID } from "node:crypto";
import type { Engine } from "../../../packages/core/src/index.js";
import type {
  ScanResult,
  SourceTask,
} from "../../../packages/contracts/src/index.js";
export function runExperiment(
  engine: Engine,
  scenario: "baseline" | "change" | "new" | "failure" | "empty",
) {
  const accountId = engine.store.get("experimentAccount", randomUUID());
  engine.store.set("experimentAccount", accountId);
  const at = engine.store.get("experimentEpoch", Date.now());
  engine.store.set("experimentEpoch", at);
  const changed =
    engine.store.get("experimentChanged", false) || scenario === "change";
  if (changed) engine.store.set("experimentChanged", true);
  const added =
    engine.store.get("experimentAdded", false) || scenario === "new";
  if (added) engine.store.set("experimentAdded", true);
  const make = (id: string, title: string, hours: number): SourceTask => ({
    sourceId: id,
    namespace: "local-experiment",
    course: "本地模拟课程",
    title: `[模拟] ${title}`,
    type: "homework",
    sourceStatus: "pending",
    deadline: {
      kind: "known",
      value: at + hours * 3600000,
      raw: "本地构造时间",
      timezone: "Asia/Shanghai",
    },
    startTime: { kind: "unknown" },
    publishTime: { kind: "unknown" },
  });
  const items = [
    make("demo-1", "编程作业 · 截止变化实验", changed ? 36 : 20),
    make("demo-2", "截止提醒实验", 0.5),
  ];
  if (added) items.push(make("demo-3", "新发布任务实验", 48));
  const scan: ScanResult = {
    platform: "ynjy",
    accountId,
    outcome: scenario === "failure" ? "failed" : "complete",
    discoveryComplete: scenario !== "failure",
    partitions:
      scenario === "failure"
        ? []
        : [
            {
              key: "local-experiment",
              outcome: "complete",
              paginationComplete: true,
              emptyConfirmed: scenario === "empty",
              items: scenario === "empty" ? [] : items,
              issues: [],
            },
          ],
    issues:
      scenario === "failure"
        ? ["模拟网络中断：应保留全部已有任务"]
        : ["本地模拟快照，不是真实平台数据"],
  };
  return engine.apply(scan);
}
