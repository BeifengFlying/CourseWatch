import { homedir } from "node:os";
import { join, resolve } from "node:path";
export const dataDir = process.env.COURSEWATCH_DATA_DIR
  ? resolve(process.env.COURSEWATCH_DATA_DIR)
  : process.platform === "darwin"
    ? join(homedir(), "Library/Application Support/CourseWatch")
    : process.platform === "win32"
      ? join(
          process.env.LOCALAPPDATA || join(homedir(), "AppData/Local"),
          "CourseWatch",
        )
      : join(homedir(), ".local/share/CourseWatch");
