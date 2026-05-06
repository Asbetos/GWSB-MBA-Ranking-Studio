import { defineConfig } from 'vite';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: './',
  publicDir: 'public',
  server: { port: 3200 },
  preview: { port: 4200 },
  build: {
    outDir: 'dist',
    rollupOptions: { input: resolve(__dirname, 'index.html') },
  },
});
