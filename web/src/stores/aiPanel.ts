import { create } from 'zustand'

/** AI 助手对话面板的展开状态（全局） */
interface AIPanelState {
  open: boolean
  setOpen: (open: boolean) => void
}

export const useAIPanelStore = create<AIPanelState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}))
