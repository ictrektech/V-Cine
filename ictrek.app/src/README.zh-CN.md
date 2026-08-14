# Nowen Video 用户使用说明

Nowen Video 是用于整理和播放家庭影音库的自托管媒体服务。

## 安装与访问

安装时按 VOS 主机架构选择 `AMD64` 或 `ARM64` profile。安装完成后，在 VOS 左侧导航进入：

```text
Nowen Video -> 家庭影音
```

## 数据目录

默认宿主机持久化根目录为：

```text
/data/vos_workspace/nowen
```

目录布局如下：

```text
/data/vos_workspace/nowen/
├── data/   # 配置和登录密钥（数据库为 VOS 共享 PGV，不落本目录）
├── cache/  # 转码缓存
└── media/  # 可由 VOS 托管的媒体目录，容器内为 /media
```

首次进入应用后注册的第一个用户会成为管理员。媒体库可选择容器内 `/media`，或在应用中配置已支持的远程存储。

`NOWEN_ADULT_SCRAPER_ENABLED` 默认关闭；仅在确有业务需求且符合当地法规时启用。
