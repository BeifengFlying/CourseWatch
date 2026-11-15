import { defineConfig } from 'vitest/config';
// Browser suites each start Chromium; bound file concurrency to avoid competing
// startup/cleanup hooks exhausting the host while keeping assertions unchanged.
// CI uses one worker after repeated browser startup timeouts on shared runners.
export default defineConfig({test:{include:['tests/**/*.test.ts'],environment:'node',maxWorkers:process.env.CI ? 1 : 2}});
