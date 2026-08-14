// 可复用的 Toggle 开关按钮（从 DashboardTab 抽出，供配置 Drawer 共用）
// onChange 接收新值（标准 switch 语义）：onChange(!checked)
export function ToggleButton({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <button
      type="button" role="switch" aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full transition-colors duration-300 focus:outline-none"
      style={{
        background: checked ? 'var(--neon-blue)' : 'var(--border-default)',
        boxShadow: checked ? 'var(--neon-glow-shadow-md)' : 'none',
      }}
    >
      <span className="pointer-events-none inline-block h-5 w-5 rounded-full shadow-lg transition-transform duration-300" style={{ transform: checked ? 'translateX(20px) translateY(2px)' : 'translateX(2px) translateY(2px)', background: checked ? '#fff' : 'var(--text-muted)' }} />
    </button>
  )
}
