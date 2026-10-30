import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { capabilityApi } from '@/api'
import type { Capability, CapabilityId, CapabilityState } from '@/types/capability'

/**
 * 全局能力状态。
 *
 * 由 Layout 挂载一次，所有订阅者共享同一份数据，避免每个页面各自探测。
 * 接口是公开只读的，不需要管理员权限。
 *
 * 刷新时机：挂载时拉一次，设置抽屉关闭时再拉一次。
 * 「去开启」按钮走整页跳转，回到业务页时 Provider 重新挂载，状态自然更新。
 *
 * 只暴露读接口：当前仅门禁组件与推荐配置消费。
 */

type CapabilitiesContextValue = {
  /** 重新拉取。设置抽屉关闭后调用，保证状态与配置同步。 */
  refresh: () => void
  get: (id: CapabilityId) => Capability | undefined
  /** 未知能力返回 unknown，调用方必须按「放行」处理。 */
  stateOf: (id: CapabilityId) => CapabilityState
}

const CapabilitiesContext = createContext<CapabilitiesContextValue | null>(null)

// Provider 外或探测失败时的兜底：全部 unknown，不阻塞任何功能。
const UNKNOWN_CONTEXT: CapabilitiesContextValue = {
  get: () => undefined,
  stateOf: () => 'unknown',
  refresh: () => {},
}

export function CapabilitiesProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Capability[]>([])
  // 请求序号：只采用最新一次请求的结果。
  const requestId = useRef(0)

  const refresh = useCallback(() => {
    const id = ++requestId.current
    capabilityApi
      .list()
      .then((res) => {
        if (id !== requestId.current) return
        setItems(res.data.data.items ?? [])
      })
      .catch((err) => {
        if (id !== requestId.current) return
        console.warn('[capabilities] 拉取失败，功能状态按 unknown 处理', err)
        setItems([])
      })
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const byId = useMemo(() => {
    const map = new Map<CapabilityId, Capability>()
    items.forEach((item) => map.set(item.id, item))
    return map
  }, [items])

  const value = useMemo<CapabilitiesContextValue>(
    () => ({
      refresh,
      get: (id) => byId.get(id),
      stateOf: (id) => byId.get(id)?.state ?? 'unknown',
    }),
    [refresh, byId],
  )

  return createElement(CapabilitiesContext.Provider, { value }, children)
}

/**
 * 读取能力状态。
 * 不在 Provider 内时返回全 unknown 的兜底值，不抛错：门禁不得因为
 * 缺少 Provider 而隐藏基础功能。
 */
export function useCapabilities(): CapabilitiesContextValue {
  return useContext(CapabilitiesContext) ?? UNKNOWN_CONTEXT
}
