import { useState, useRef } from 'react'
import { adminApi } from '@/api'
import { useToast } from '@/components/Toast'
import type { TMDbImageInfo } from '@/types'
import { Upload, Link2, Search, Image, X, Check, Loader2 } from 'lucide-react'
import clsx from 'clsx'

// 图片来源模式
type ImageSourceMode = 'upload' | 'url' | 'tmdb'

// 图片编辑类型
type ImageEditType = 'poster' | 'backdrop'

interface EditMetadataModalProps {
  type: 'media' | 'series'
  id: string
  tmdbId?: number
  mediaType?: string // movie 或 tv，仅 Media 用
  editForm: Record<string, any>
  setEditForm: (form: any) => void
  currentPoster: string
  hasPoster: boolean
  hasBackdrop: boolean
  onSave: () => Promise<void> | void
  onClose: () => void
  /** 是否包含 tagline 字段（仅 Media） */
  hasTagline?: boolean
}

export default function EditMetadataModal({
  type,
  id,
  tmdbId,
  mediaType,
  editForm,
  setEditForm,
  currentPoster,
  hasPoster,
  hasBackdrop,
  onSave,
  onClose,
  hasTagline = false,
}: EditMetadataModalProps) {
  const toast = useToast()
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 图片编辑状态
  const [imageTab, setImageTab] = useState<ImageEditType>('poster')
  const [imageMode, setImageMode] = useState<ImageSourceMode | null>(null)
  const [imageUrl, setImageUrl] = useState('')
  const [imageUploading, setImageUploading] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)

  // TMDb 图片搜索
  const [tmdbImages, setTmdbImages] = useState<{ posters: TMDbImageInfo[]; backdrops: TMDbImageInfo[] } | null>(null)
  const [tmdbImagesLoading, setTmdbImagesLoading] = useState(false)
  const [selectedTmdbPath, setSelectedTmdbPath] = useState<string | null>(null)

  // 加载 TMDb 可用图片
  const handleLoadTmdbImages = async () => {
    if (!tmdbId || tmdbId <= 0) {
      toast.error('当前条目未关联 TMDb，请先手动匹配')
      return
    }
    setTmdbImagesLoading(true)
    try {
      const tmdbType = type === 'series' ? 'tv' : (mediaType || 'movie')
      const res = await adminApi.searchTMDbImages(tmdbId, tmdbType)
      setTmdbImages(res.data.data)
      const imgs = imageTab === 'poster' ? res.data.data.posters : res.data.data.backdrops
      if (imgs.length === 0) {
        toast.info('TMDb 上暂无可用图片')
      }
    } catch {
      toast.error('获取 TMDb 图片列表失败')
    } finally {
      setTmdbImagesLoading(false)
    }
  }

  // 文件选择处理
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // 格式校验
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp']
    if (!allowedTypes.includes(file.type)) {
      toast.error('仅支持 JPG、PNG、WebP 格式')
      return
    }
    // 大小校验
    if (file.size > 10 * 1024 * 1024) {
      toast.error('图片文件过大，最大支持 10MB')
      return
    }

    setSelectedFile(file)
    const reader = new FileReader()
    reader.onload = () => setPreviewUrl(reader.result as string)
    reader.readAsDataURL(file)
  }

  // 确认上传/应用图片
  const handleApplyImage = async () => {
    setImageUploading(true)
    try {
      if (imageMode === 'upload' && selectedFile) {
        if (type === 'media') {
          await adminApi.uploadMediaImage(id, selectedFile, imageTab)
        } else {
          await adminApi.uploadSeriesImage(id, selectedFile, imageTab)
        }
        toast.success(`${imageTab === 'poster' ? '海报' : '背景图'}已更新`)
      } else if (imageMode === 'url' && imageUrl.trim()) {
        if (type === 'media') {
          await adminApi.setMediaImageByURL(id, imageUrl.trim(), imageTab)
        } else {
          await adminApi.setSeriesImageByURL(id, imageUrl.trim(), imageTab)
        }
        toast.success(`${imageTab === 'poster' ? '海报' : '背景图'}已更新`)
      } else if (imageMode === 'tmdb' && selectedTmdbPath) {
        if (type === 'media') {
          await adminApi.setMediaImageFromTMDb(id, selectedTmdbPath, imageTab)
        } else {
          await adminApi.setSeriesImageFromTMDb(id, selectedTmdbPath, imageTab)
        }
        toast.success(`${imageTab === 'poster' ? '海报' : '背景图'}已更新`)
      }
      // 重置图片编辑状态
      setImageMode(null)
      setPreviewUrl(null)
      setSelectedFile(null)
      setImageUrl('')
      setSelectedTmdbPath(null)
    } catch (err: any) {
      toast.error(err?.response?.data?.error || '图片更新失败')
    } finally {
      setImageUploading(false)
    }
  }

  const inputStyle = {
    background: 'var(--bg-surface)',
    border: '1px solid var(--border-default)',
    color: 'var(--text-primary)',
  }

  const tmdbImageList = tmdbImages
    ? (imageTab === 'poster' ? tmdbImages.posters : tmdbImages.backdrops)
    : []

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm" style={{ background: 'rgba(0,0,0,0.7)' }}>
      <div
        className="w-full max-w-3xl rounded-2xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto"
        style={{ background: 'var(--bg-elevated)', border: '1px solid var(--glass-border)' }}
      >
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>编辑元数据</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-white/5 transition-colors" style={{ color: 'var(--text-muted)' }}>
            <X size={18} />
          </button>
        </div>

        {/* ==================== 图片更换区域 ==================== */}
        <div className="mb-6 rounded-xl p-4" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-default)' }}>
          <div className="flex items-center gap-3 mb-3">
            <Image size={16} style={{ color: 'var(--neon-blue)' }} />
            <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>图片管理</span>
            {/* 海报/背景图切换 */}
            <div className="ml-auto flex rounded-lg overflow-hidden" style={{ border: '1px solid var(--border-default)' }}>
              <button
                onClick={() => { setImageTab('poster'); setImageMode(null); setSelectedTmdbPath(null) }}
                className={clsx('px-3 py-1 text-xs font-medium transition-colors', imageTab === 'poster' ? 'text-white' : '')}
                style={imageTab === 'poster' ? { background: 'var(--neon-blue)', color: 'white' } : { color: 'var(--text-secondary)' }}
              >
                海报
              </button>
              <button
                onClick={() => { setImageTab('backdrop'); setImageMode(null); setSelectedTmdbPath(null) }}
                className={clsx('px-3 py-1 text-xs font-medium transition-colors', imageTab === 'backdrop' ? 'text-white' : '')}
                style={imageTab === 'backdrop' ? { background: 'var(--neon-blue)', color: 'white' } : { color: 'var(--text-secondary)' }}
              >
                背景图
              </button>
            </div>
          </div>

          {/* 当前图片预览 + 操作按钮 */}
          <div className="flex gap-4">
            {/* 预览区 */}
            <div
              className="relative flex-shrink-0 overflow-hidden rounded-lg"
              style={{
                width: imageTab === 'poster' ? 80 : 128,
                height: imageTab === 'poster' ? 120 : 72,
                background: 'var(--bg-card)',
                border: '1px solid var(--border-default)',
              }}
            >
              {previewUrl ? (
                <img src={previewUrl} alt="预览" className="h-full w-full object-cover" />
              ) : selectedTmdbPath ? (
                <img
                  src={`https://image.tmdb.org/t/p/${imageTab === 'poster' ? 'w185' : 'w300'}${selectedTmdbPath}`}
                  alt="TMDb预览"
                  className="h-full w-full object-cover"
                />
              ) : (imageTab === 'poster' ? hasPoster : hasBackdrop) ? (
                <img src={currentPoster} alt="当前图片" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center" style={{ color: 'var(--text-muted)' }}>
                  <Image size={20} />
                </div>
              )}
            </div>

            {/* 操作区 */}
            <div className="flex-1 space-y-2">
              {!imageMode && (
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => { setImageMode('upload'); setPreviewUrl(null); setSelectedFile(null) }}
                    className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors hover:opacity-80"
                    style={{ background: 'var(--neon-blue-8)', color: 'var(--neon-blue)', border: '1px solid var(--neon-blue-15)' }}
                  >
                    <Upload size={12} /> 本地上传
                  </button>
                  <button
                    onClick={() => { setImageMode('url'); setImageUrl('') }}
                    className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors hover:opacity-80"
                    style={{ background: 'var(--neon-blue-8)', color: 'var(--neon-blue)', border: '1px solid var(--neon-blue-15)' }}
                  >
                    <Link2 size={12} /> 输入URL
                  </button>
                  <button
                    onClick={() => { setImageMode('tmdb'); handleLoadTmdbImages() }}
                    className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors hover:opacity-80"
                    style={{ background: 'var(--neon-blue-8)', color: 'var(--neon-blue)', border: '1px solid var(--neon-blue-15)' }}
                  >
                    <Search size={12} /> TMDb搜索
                  </button>
                </div>
              )}

              {/* 本地上传模式 */}
              {imageMode === 'upload' && (
                <div className="space-y-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".jpg,.jpeg,.png,.webp"
                    onChange={handleFileSelect}
                    className="hidden"
                  />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full rounded-lg border-2 border-dashed py-3 text-center text-xs transition-colors hover:border-neon-blue/30"
                    style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}
                  >
                    {selectedFile ? (
                      <span style={{ color: 'var(--neon-blue)' }}>✓ {selectedFile.name}</span>
                    ) : (
                      '点击选择图片文件（JPG / PNG / WebP，最大 10MB）'
                    )}
                  </button>
                  <div className="flex gap-2">
                    <button
                      onClick={() => { setImageMode(null); setPreviewUrl(null); setSelectedFile(null) }}
                      className="rounded-lg px-3 py-1 text-xs"
                      style={{ color: 'var(--text-secondary)', border: '1px solid var(--border-default)' }}
                    >
                      取消
                    </button>
                    {selectedFile && (
                      <button
                        onClick={handleApplyImage}
                        disabled={imageUploading}
                        className="flex items-center gap-1 rounded-lg px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
                        style={{ background: 'var(--neon-blue)' }}
                      >
                        {imageUploading ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                        确认上传
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* URL 输入模式 */}
              {imageMode === 'url' && (
                <div className="space-y-2">
                  <input
                    value={imageUrl}
                    onChange={(e) => setImageUrl(e.target.value)}
                    placeholder="输入图片URL地址..."
                    className="w-full rounded-lg px-3 py-2 text-xs outline-none"
                    style={inputStyle}
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => { setImageMode(null); setImageUrl('') }}
                      className="rounded-lg px-3 py-1 text-xs"
                      style={{ color: 'var(--text-secondary)', border: '1px solid var(--border-default)' }}
                    >
                      取消
                    </button>
                    {imageUrl.trim() && (
                      <button
                        onClick={handleApplyImage}
                        disabled={imageUploading}
                        className="flex items-center gap-1 rounded-lg px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
                        style={{ background: 'var(--neon-blue)' }}
                      >
                        {imageUploading ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                        确认下载
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* TMDb 搜索模式 */}
              {imageMode === 'tmdb' && (
                <div className="space-y-2">
                  {tmdbImagesLoading ? (
                    <div className="flex items-center gap-2 py-3 text-xs" style={{ color: 'var(--text-muted)' }}>
                      <Loader2 size={14} className="animate-spin" /> 加载 TMDb 图片列表...
                    </div>
                  ) : tmdbImageList.length > 0 ? (
                    <>
                      <div className="grid grid-cols-4 gap-2 max-h-40 overflow-y-auto pr-1 sm:grid-cols-5">
                        {tmdbImageList.slice(0, 20).map((img) => (
                          <button
                            key={img.file_path}
                            onClick={() => { setSelectedTmdbPath(img.file_path); setPreviewUrl(null) }}
                            className={clsx(
                              'relative overflow-hidden rounded-lg transition-all hover:ring-2 hover:ring-neon-blue/50',
                              selectedTmdbPath === img.file_path && 'ring-2 ring-neon-blue'
                            )}
                            style={{ border: '1px solid var(--border-default)' }}
                          >
                            <img
                              src={`https://image.tmdb.org/t/p/${imageTab === 'poster' ? 'w92' : 'w185'}${img.file_path}`}
                              alt=""
                              className="w-full object-cover"
                              style={{ aspectRatio: imageTab === 'poster' ? '2/3' : '16/9' }}
                            />
                            {selectedTmdbPath === img.file_path && (
                              <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                                <Check size={16} className="text-neon-blue" />
                              </div>
                            )}
                            <div className="absolute bottom-0 left-0 right-0 px-1 py-0.5 text-[9px] text-center text-white/70" style={{ background: 'rgba(0,0,0,0.6)' }}>
                              {img.width}×{img.height}
                            </div>
                          </button>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => { setImageMode(null); setSelectedTmdbPath(null) }}
                          className="rounded-lg px-3 py-1 text-xs"
                          style={{ color: 'var(--text-secondary)', border: '1px solid var(--border-default)' }}
                        >
                          取消
                        </button>
                        {selectedTmdbPath && (
                          <button
                            onClick={handleApplyImage}
                            disabled={imageUploading}
                            className="flex items-center gap-1 rounded-lg px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
                            style={{ background: 'var(--neon-blue)' }}
                          >
                            {imageUploading ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                            应用选中图片
                          </button>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        {!tmdbId ? '当前条目未关联 TMDb，请先手动匹配后再搜索图片' : '暂无可用图片'}
                      </p>
                      <button
                        onClick={() => { setImageMode(null); setSelectedTmdbPath(null) }}
                        className="rounded-lg px-3 py-1 text-xs"
                        style={{ color: 'var(--text-secondary)', border: '1px solid var(--border-default)' }}
                      >
                        返回
                      </button>
                    </div>
                  )}
                </div>
              )}

              {!imageMode && (
                <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                  支持 JPG、PNG、WebP 格式，最大 10MB
                </p>
              )}
            </div>
          </div>
        </div>

        {/* ==================== 文本字段编辑 ==================== */}
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>标题</label>
              <input
                value={editForm.title}
                onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                className="w-full rounded-xl px-3 py-2 text-sm outline-none"
                style={inputStyle}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>原始标题</label>
              <input
                value={editForm.orig_title}
                onChange={(e) => setEditForm({ ...editForm, orig_title: e.target.value })}
                className="w-full rounded-xl px-3 py-2 text-sm outline-none"
                style={inputStyle}
              />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>年份</label>
              <input
                type="number"
                value={editForm.year || ''}
                onChange={(e) => setEditForm({ ...editForm, year: parseInt(e.target.value) || 0 })}
                className="w-full rounded-xl px-3 py-2 text-sm outline-none"
                style={inputStyle}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>评分</label>
              <input
                type="number"
                step="0.1"
                min="0"
                max="10"
                value={editForm.rating || ''}
                onChange={(e) => setEditForm({ ...editForm, rating: parseFloat(e.target.value) || 0 })}
                className="w-full rounded-xl px-3 py-2 text-sm outline-none"
                style={inputStyle}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>类型</label>
              <input
                value={editForm.genres}
                onChange={(e) => setEditForm({ ...editForm, genres: e.target.value })}
                placeholder="逗号分隔，如：动作,科幻"
                className="w-full rounded-xl px-3 py-2 text-sm outline-none"
                style={inputStyle}
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>简介</label>
            <textarea
              value={editForm.overview}
              onChange={(e) => setEditForm({ ...editForm, overview: e.target.value })}
              rows={4}
              className="w-full resize-none rounded-xl px-3 py-2 text-sm outline-none"
              style={inputStyle}
            />
          </div>
          {hasTagline && (
            <div>
              <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>宣传语</label>
              <input
                value={editForm.tagline || ''}
                onChange={(e) => setEditForm({ ...editForm, tagline: e.target.value })}
                className="w-full rounded-xl px-3 py-2 text-sm outline-none"
                style={inputStyle}
              />
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>国家/地区</label>
              <input
                value={editForm.country}
                onChange={(e) => setEditForm({ ...editForm, country: e.target.value })}
                className="w-full rounded-xl px-3 py-2 text-sm outline-none"
                style={inputStyle}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>语言</label>
              <input
                value={editForm.language}
                onChange={(e) => setEditForm({ ...editForm, language: e.target.value })}
                className="w-full rounded-xl px-3 py-2 text-sm outline-none"
                style={inputStyle}
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>出品公司</label>
            <input
              value={editForm.studio}
              onChange={(e) => setEditForm({ ...editForm, studio: e.target.value })}
              className="w-full rounded-xl px-3 py-2 text-sm outline-none"
              style={inputStyle}
            />
          </div>
        </div>

        {/* 底部按钮 */}
        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="rounded-xl px-5 py-2.5 text-sm font-medium transition-colors"
            style={{ color: 'var(--text-secondary)', background: 'var(--bg-surface)', border: '1px solid var(--border-default)' }}
          >
            取消
          </button>
          <button
            onClick={onSave}
            className="rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition-all hover:opacity-90"
            style={{ background: 'var(--neon-blue)' }}
          >
            保存
          </button>
        </div>
      </div>
    </div>
  )
}
