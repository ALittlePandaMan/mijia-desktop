import { defineConfig } from 'vite';

export default defineConfig({
  clearScreen: false,
  // Historical extracted delivery folders are not application entry points.
  optimizeDeps: { entries: ['index.html', 'scripts/*-fixture.html'], include: ['@tauri-apps/api/core', '@tauri-apps/api/window'] },
  server: {
    port: 1420,
    strictPort: true,
    host: '127.0.0.1',
    watch: { ignored: ['**/src-tauri/**', '**/research/**', '**/.tools/**', '**/deliverables/**', '**/licenses/**', '**/*.apk'] },
  },
  build: { target: 'es2022' },
});
