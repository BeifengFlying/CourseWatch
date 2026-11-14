import { Adapters, type PlatformState } from "./index.js";
import { type PlatformId } from "../../contracts/src/index.js";
const adapters = new Adapters(process.env.COURSEWATCH_WORKER_DIR!, () =>
  process.send?.({ event: "loginClosed" }),
);
process.on(
  "message",
  async (message: {
    id: number;
    action: "login" | "finish" | "cancel" | "scan";
    platform?: PlatformId;
    state?: PlatformState;
  }) => {
    try {
      const result =
        message.action === "scan"
          ? await adapters.scan(message.state!)
          : message.action === "login"
            ? await adapters.login(message.platform!)
            : message.action === "finish"
              ? await adapters.finish(message.platform!)
              : await adapters.cancel();
      process.send?.({ id: message.id, result: result ?? { ok: true } });
    } catch (error) {
      process.send?.({ id: message.id, error: (error as Error).message });
    }
  },
);
process.on("disconnect", async () => {
  await adapters.cancel();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  await adapters.cancel();
  process.exit(0);
});
