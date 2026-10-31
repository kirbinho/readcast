import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

// Auf GitHub Pages liegt die App unter /<repository>/
export default defineConfig({
  base: process.env.READCAST_BASE ?? '/',
  plugins: [preact()],
  build: { target: 'es2022' },
});
