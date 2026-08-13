import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// 允许通过环境变量自定义后端代理目标和前端监听端口，
// 便于本地脚本（scripts/run-web.bat）灵活更换端口。
const apiProxyTarget = process.env.VITE_API_PROXY_TARGET || 'http://localhost:8080'
const devPort = Number(process.env.WEB_PORT) || 3000

export default defineConfig({
  plugins: [react()],
  // 相对资源路径：配合后端注入的 <base href>，使前端可在 VOS 子路径
  // (/app/com.ictrek.nowen-video/) 与根路径下通用部署。
  base: './',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: devPort,
    host: true, // 监听所有网络接口
    proxy: {
      '/api': {
        target: apiProxyTarget,
        changeOrigin: true,
        ws: true, // 支持WebSocket代理
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
})
