import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['tests/**/*.test.ts', 'apps/**/tests/**/*.test.ts'], exclude: ['tests/smoke/**', '**/node_modules/**'], testTimeout: 30000 } });
