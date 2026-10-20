import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  // Relative asset paths, so the same build serves from a domain root or a
  // subpath such as GitHub Pages' /wfm-demo/.
  base: './',
  // The spreadsheet library is its own chunk, loaded only on first export.
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 1000 },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
