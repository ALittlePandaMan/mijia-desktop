import { defineConfig } from 'vite';
import {widgetBoundary} from './scripts/widget-boundary.mjs';

export default defineConfig({
  plugins:[widgetBoundary()],
  clearScreen: false,
  // Historical extracted delivery folders are not application entry points.
  optimizeDeps: { entries: ['index.html', 'scripts/*-fixture.html'], include: ['@tauri-apps/api/core', '@tauri-apps/api/event', '@tauri-apps/api/window'] },
  server: {
    port: 1420,
    strictPort: true,
    host: '127.0.0.1',
    watch: { ignored: ['**/src-tauri/**', '**/research/**', '**/.tools/**', '**/deliverables/**', '**/licenses/**', '**/*.apk'] },
  },
  build: { target: 'es2022',rollupOptions:{input:{main:'index.html',widget:'widget.html'}} },
});
