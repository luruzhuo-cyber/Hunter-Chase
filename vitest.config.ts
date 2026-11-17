import { defineConfig } from 'vitest/config';
// Source snapshots under experiment/temp folders must never become extra test suites.
export default defineConfig({test:{include:['src/**/*.test.ts','scripts/**/*.test.ts','training/bridge.test.ts']}});
