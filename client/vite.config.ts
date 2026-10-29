import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

// Two pages: the game, and a standalone login test that uses React for Privy.
export default defineConfig({
  envDir: '..',
  // near-api-js depends on packages that expect Node's process, Buffer and util.
  plugins: [react(), nodePolyfills({ include: ['process', 'buffer', 'util'], globals: { process: true, Buffer: true } })],
  build: {
    rollupOptions: {
      // Privy imports optional Solana packages this game doesn't install.
      shimMissingExports: true,
      input: {
        game: resolve(import.meta.dirname, 'index.html'),
        privyTest: resolve(import.meta.dirname, 'privy-test.html'),
      },
    },
  },
});
