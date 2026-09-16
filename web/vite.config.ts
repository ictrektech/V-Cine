import { defineConfig, type ProxyOptions } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// 允许通过环境变量自定义后端代理目标和前端监听端口，
// 便于本地脚本（scripts/run-web.bat）灵活更换端口。
const apiProxyTarget = process.env.VITE_API_PROXY_TARGET || 'http://localhost:8080'
const devPort = Number(process.env.WEB_PORT) || 3000

// VOS 部署时通过 VITE_BASE 注入 Traefik 路径前缀（如 /app/com.ictrek.v-cine/），
// 与 VAI 其他 app 对齐；根路径/Tauri 构建不设 VITE_BASE，使用根绝对路径，
// 避免深层路由刷新时相对资源解析到 /play/... 下 404。
const base = process.env.VITE_BASE || '/'
const basePath = base.startsWith('/') ? base.replace(/\/+$/, '') : ''
const apiProxy = {
  target: apiProxyTarget,
  changeOrigin: true,
  ws: true, // 支持WebSocket代理
}
const proxy: Record<string, ProxyOptions> = {
  '/api': apiProxy,
}
if (basePath) {
  // VITE_BASE 调试时，API 请求也会带前缀，这里剥掉后再转发给后端。
  proxy[`${basePath}/api`] = {
    ...apiProxy,
    rewrite: (p: string) => p.slice(basePath.length),
  }
}

// VITE_ALLOWED_HOSTS=true 放行任意 Host；不设置则用 vite 默认（只放行 localhost/IP，域名会 403）
const allowedHosts = process.env.VITE_ALLOWED_HOSTS === 'true' || undefined

export default defineConfig({
  plugins: [react()],
  base,
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: devPort,
    host: true, // 监听所有网络接口
    // 未设置 VITE_ALLOWED_HOSTS 时不写该字段，等价于 vite 默认行为
    ...(allowedHosts === undefined ? {} : { allowedHosts }),
    proxy,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
})
