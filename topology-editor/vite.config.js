import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  root: '.',
  base: '/topology-editor/',
  build: {
    outDir: '../public/topology-editor',
    emptyOutDir: true,
  },
});
