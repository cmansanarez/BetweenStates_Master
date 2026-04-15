// vite.config.js
export default {
  // Expose the dev server to the local network so you can test on mobile.
  // After `npm run dev`, Vite will print both localhost and network URLs.
  server: {
    host: true,   // binds to 0.0.0.0 — accessible from other devices on the same Wi-Fi
    port: 5173,
  },

  // Pre-bundle these CJS/hybrid packages so Vite can handle them correctly.
  // hydra-synth uses regl and other browser-global dependencies that need
  // to be included in Vite's dep-optimization step.
  // No npm deps to optimize — heavy libs (hydra-synth, p5) load via CDN.
  optimizeDeps: {},

  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  },
};
