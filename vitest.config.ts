import { defineConfig } from 'vitest/config';
// Browser suites each start Chromium; bound file concurrency to avoid competing
// startup/cleanup hooks exhausting the host while keeping assertions unchanged.
export default defineConfig({test:{include:['tests/**/*.test.ts'],environment:'node',maxWorkers:2}});
