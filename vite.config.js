import { defineConfig } from 'vite';

export default defineConfig({
  publicDir: 'voice-samples',
  server: {
    port: 3000,
    open: true
  },
  build: {
    target: 'esnext',
    outDir: 'dist'
  },
  optimizeDeps: {
    exclude: ['onnxruntime-web']
  }
});
