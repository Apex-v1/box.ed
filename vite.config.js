import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // GLB files are served as raw binary assets from public/
  // No special config needed — Vite handles public/ automatically.
});
