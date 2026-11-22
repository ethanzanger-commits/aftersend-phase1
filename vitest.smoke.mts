import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['tests/smoke/**/*.test.ts'], testTimeout: 180000, hookTimeout: 60000 } });
