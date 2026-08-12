import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// 允许通过环境变量自定义后端代理目标和前端监听端口，
// 便于本地脚本（scripts/run-web.bat）灵活更换端口。
const apiProxyTarget = process.env.VITE_API_PROXY_TARGET || 'http://localhost:8080'
const devPort = Number(process.env.WEB_PORT) || 3000

export default defineConfig({
  plugins: [react()],
  // 相对路径打包：index.html 由服务端注入 <base href="/app/<app-id>/">，
  // 资源引用（/assets/... 等）会解析到 iframe 前缀下，兼容 VOS 子路径部署；
  // 独立部署时 <base> 为空，相对路径同样正确。
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
