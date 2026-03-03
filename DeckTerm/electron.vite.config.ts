import { resolve } from 'path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    // Serve the build/ directory as the public root so DeckTerm.png
    // is accessible as /DeckTerm.png in the renderer HTML.
    publicDir: resolve('build'),
  }
});
