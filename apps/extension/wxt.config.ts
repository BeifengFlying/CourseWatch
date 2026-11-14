import { APP_VERSION } from "../../packages/contracts/src/version.js";
import { defineConfig } from "wxt";
export default defineConfig({
  modules: ["@wxt-dev/module-vue"],
  manifest: {
    name: "CourseWatch",
    version: APP_VERSION,
    description: "本地教学任务监控实验版",
    permissions: ["storage"],
    host_permissions: ["http://127.0.0.1:17321/*"],
    action: { default_title: "打开 CourseWatch" },
  },
});
