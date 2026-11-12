import { resolve } from 'path'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

/**
 * Standalone Web Playground build config:
 * Compiles the pure-browser Machinations v2 Game Economy & Mechanics Studio
 * into `website/playground/` with relative asset paths (`./`) so it runs identically
 * on GitHub Pages (`/ai-art-engine/playground/`), Aliyun OSS (`/playground/`), and `npm run site`.
 */
export default defineConfig({
  root: resolve(__dirname, 'src/playground'),
  base: './',
  publicDir: false,
  plugins: [vue()],
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer/src'),
      '@shared': resolve(__dirname, 'src/shared')
    }
  },
  worker: {
    format: 'es'
  },
  build: {
    outDir: resolve(__dirname, 'website/playground'),
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const norm = id.replace(/\\/g, '/')
          if (norm.includes('/node_modules/')) return 'vendor'
          if (norm.includes('/src/shared/gameAssets/')) return 'mx-engine'
          if (norm.includes('/machinations/MxCanvas.vue')) return 'mx-canvas'
          if (
            norm.includes('/machinations/MxResultsPanel.vue') ||
            norm.includes('/machinations/MxNumericalWorkbenchPanel.vue') ||
            norm.includes('/machinations/MxCardDesignLabPanel.vue')
          ) {
            return 'mx-results'
          }
          if (
            norm.includes('/machinations/MxDrawer.vue') ||
            norm.includes('/machinations/MxInspector.vue') ||
            norm.includes('/machinations/MxFormula')
          ) {
            return 'mx-panels'
          }
          return undefined
        }
      }
    }
  }
})
