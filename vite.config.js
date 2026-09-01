import { defineConfig } from 'vite';

// GitHub Pages serves the project site from /<repo>/, so every asset URL needs
// that prefix. Locally `vite dev` and `vite preview` are happy with it too.
export default defineConfig({
  base: '/anomie/',
  build: {
    target: 'esnext',
    // WebLLM's wasm loader is large and not worth warning about on every build.
    chunkSizeWarningLimit: 2000,
  },
  worker: {
    format: 'es',
  },
});
