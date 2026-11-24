import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Single-bundle build: one game.js + one style.css, so the game can be hosted as a plain page.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    target: 'es2020',
    cssCodeSplit: false,
    assetsInlineLimit: 100000000,
    chunkSizeWarningLimit: 9000,
    rollupOptions: {
      output: {
        codeSplitting: false,
        entryFileNames: 'game.js',
        assetFileNames: (a) => (a.names?.[0]?.endsWith('.css') ? 'style.css' : '[name][extname]'),
      },
    },
  },
});
