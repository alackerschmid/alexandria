import { execSync } from 'node:child_process'
import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import Vue from '@vitejs/plugin-vue'
import Fonts from 'unplugin-fonts/vite'
import { defineConfig } from 'vite'
import Vuetify, { transformAssetUrls } from 'vite-plugin-vuetify'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    tailwindcss(),
    Vue({
      template: { transformAssetUrls },
    }),
    Vuetify({
      autoImport: true,
      styles: {
        configFile: 'src/styles/settings.scss',
      },
    }),
    Fonts({
      fontsource: {
        families: [
          {
            name: 'Roboto Mono',
            weights: [400, 700],
          },
          {
            name: 'Roboto',
            weights: [100, 300, 400, 500, 700, 900],
            styles: ['normal', 'italic'],
          },
          // Faces for the typeface presets in src/utils/appearance.ts. 700 is the
          // heaviest weight the UI uses (headings are font-bold) — deliberately,
          // so no preset outruns Lora and Space Mono, which have no 900.
          // `styles` is only listed for families that actually ship italics;
          // Space Grotesk and Oswald don't, so italic body text there is
          // synthesized by the browser.
          {
            name: 'Playfair Display', // editorial heading
            weights: [700],
          },
          {
            name: 'Lora', // serif heading + body
            weights: [400, 500, 600, 700],
            styles: ['normal', 'italic'],
          },
          {
            name: 'Space Grotesk', // sans heading + body
            weights: [400, 500, 700],
          },
          {
            name: 'Oswald', // condensed heading
            weights: [400, 500, 700],
          },
          {
            name: 'Barlow', // condensed body
            weights: [400, 500, 700],
            styles: ['normal', 'italic'],
          },
          // Mono faces. --font-mono drives the uppercase micro-labels, so each
          // preset needs its own; 400/700 matches Roboto Mono's weights. Space
          // Mono doubles as the `typewriter` preset's heading and body face.
          {
            name: 'IBM Plex Mono',
            weights: [400, 700],
          },
          {
            name: 'Courier Prime',
            weights: [400, 700],
          },
          {
            name: 'Space Mono',
            weights: [400, 700],
            styles: ['normal', 'italic'],
          },
          {
            name: 'Overpass Mono', // condensed mono — distinct from sans's IBM Plex Mono
            weights: [400, 700],
          },
        ],
      },
    }),
  ],
  define: {
    'process.env': {},
    __COMMIT_HASH__: JSON.stringify(
      (() => { try { return execSync('git rev-parse --short HEAD').toString().trim() } catch { return 'dev' } })()
    ),
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('src', import.meta.url)),
    },
    extensions: [
      '.js',
      '.json',
      '.jsx',
      '.mjs',
      '.ts',
      '.tsx',
      '.vue',
    ],
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
})
