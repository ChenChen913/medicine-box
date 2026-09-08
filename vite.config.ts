import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // 使用相对路径，这样同一个构建产物既能跑在 https://<user>.github.io/<repo>/
  // 也能跑在根路径或任意子目录下，不需要关心仓库名。
  base: './',
  build: {
    outDir: 'dist',
  },
  server: {
    host: true,
    port: 5173,
  },
  preview: {
    host: true,
    port: 4173,
  }
})
