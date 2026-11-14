import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../packages/storage/src/index.js";
import { Engine } from "../packages/core/src/index.js";
import { runExperiment } from "../apps/local-service/src/experiment.js";
const dir = await mkdtemp(join(tmpdir(), "coursewatch-experiment-"));
const store = new Store(join(dir, "experiment.db"));
const engine = new Engine(store);
try {
  for (const scenario of [
    "baseline",
    "baseline",
    "new",
    "new",
    "change",
    "failure",
    "empty",
  ] as const) {
    const result = runExperiment(engine, scenario);
    console.log(
      JSON.stringify({
        scenario,
        ...result,
        tasks: engine.tasks().length,
        needsReview: engine.tasks().filter((t) => t.needsReview).length,
        notifications: store.all("SELECT id FROM outbox").length,
      }),
    );
  }
} finally {
  store.close();
  await rm(dir, { recursive: true, force: true });
}
