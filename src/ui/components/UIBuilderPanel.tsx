import { ChangeEvent, DragEvent, useEffect, useRef, useState } from 'react'
import {
  FileText,
  ImagePlus,
  Loader2,
  Palette,
  Send,
  Sparkles,
  Trash2,
  Type,
  Upload,
  X,
} from 'lucide-react'
import { useAgentStore, useUIBuilderStore } from '@/application/store'
import { runAgent } from '@/application/agentRuntime'

const MAX_IMAGE_SIZE = 12 * 1024 * 1024

const FONT_STYLES = [
  { value: 'modern-sans', label: 'Modern sans', description: 'Inter / clean UI' },
  { value: 'editorial-serif', label: 'Editorial serif', description: 'Playfair / premium' },
  { value: 'bold-display', label: 'Bold display', description: 'Space Grotesk / strong' },
  { value: 'friendly-rounded', label: 'Friendly rounded', description: 'Nunito / approachable' },
  { value: 'technical-mono', label: 'Technical mono', description: 'JetBrains Mono / precise' },
  { value: 'custom', label: 'Custom font direction', description: 'Describe it in the prompt' },
]

interface ImageAnalysis {
  width: number
  height: number
  orientation: 'landscape' | 'portrait' | 'square'
  colors: string[]
  extractedText: string
}

function toHex(value: number): string {
  return value.toString(16).padStart(2, '0')
}

function imageDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    const url = URL.createObjectURL(file)
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve({ width: image.naturalWidth, height: image.naturalHeight })
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('The image could not be read.'))
    }
    image.src = url
  })
}

async function analyzeImage(file: File): Promise<ImageAnalysis> {
  const { width, height } = await imageDimensions(file)
  const image = new Image()
  const imageUrl = URL.createObjectURL(file)

  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve()
    image.onerror = () => reject(new Error('The image could not be analyzed.'))
    image.src = imageUrl
  })

  const scale = Math.min(1, 144 / Math.max(width, height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  const context = canvas.getContext('2d', { willReadFrequently: true })

  if (!context) {
    URL.revokeObjectURL(imageUrl)
    throw new Error('Your browser does not support image analysis.')
  }

  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  URL.revokeObjectURL(imageUrl)

  const colorCounts = new Map<string, number>()
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
  for (let index = 0; index < pixels.length; index += 16) {
    if (pixels[index + 3] < 200) continue
    const red = Math.min(255, Math.round(pixels[index] / 32) * 32)
    const green = Math.min(255, Math.round(pixels[index + 1] / 32) * 32)
    const blue = Math.min(255, Math.round(pixels[index + 2] / 32) * 32)
    const color = `#${toHex(red)}${toHex(green)}${toHex(blue)}`
    colorCounts.set(color, (colorCounts.get(color) ?? 0) + 1)
  }

  const colors = [...colorCounts.entries()]
    .sort(([, countA], [, countB]) => countB - countA)
    .slice(0, 5)
    .map(([color]) => color)

  let extractedText = ''
  try {
    const { recognize } = await import('tesseract.js')
    const result = await recognize(file, 'eng')
    extractedText = result.data.text.replace(/\s+/g, ' ').trim().slice(0, 400)
  } catch (error) {
    console.warn('OCR was unavailable for the uploaded image.', error)
  }

  return {
    width,
    height,
    orientation: width === height ? 'square' : width > height ? 'landscape' : 'portrait',
    colors,
    extractedText,
  }
}

export function UIBuilderPanel() {
  const { isOpen, setOpen } = useUIBuilderStore()
  const { modelReady, modelError, status } = useAgentStore()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [imageName, setImageName] = useState('')
  const [analysis, setAnalysis] = useState<ImageAnalysis | null>(null)
  const [prompt, setPrompt] = useState('')
  const [fontStyle, setFontStyle] = useState(FONT_STYLES[0].value)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [statusText, setStatusText] = useState('')

  useEffect(() => () => {
    if (imageUrl) URL.revokeObjectURL(imageUrl)
  }, [imageUrl])

  const clearImage = () => {
    setImageUrl(null)
    setImageName('')
    setAnalysis(null)
    setStatusText('Reference image removed.')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const processFile = async (file?: File) => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setStatusText('Please upload a PNG, JPG, WEBP, GIF, or another image file.')
      return
    }
    if (file.size > MAX_IMAGE_SIZE) {
      setStatusText('Please choose an image smaller than 12 MB.')
      return
    }

    setIsAnalyzing(true)
    setStatusText('Analyzing image, colors, layout, and visible text…')
    setAnalysis(null)
    setImageName(file.name)
    setImageUrl(URL.createObjectURL(file))

    try {
      const result = await analyzeImage(file)
      setAnalysis(result)
      setStatusText(result.extractedText ? 'Image analysis complete — colors and text are ready.' : 'Image analysis complete — colors and layout are ready.')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Image analysis failed.'
      setStatusText(message)
    } finally {
      setIsAnalyzing(false)
    }
  }

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    void processFile(event.target.files?.[0])
  }

  const handleDrop = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault()
    void processFile(event.dataTransfer.files?.[0])
  }

  const submitDesignRequest = async () => {
    if (!prompt.trim()) {
      setStatusText('Add a design instruction before applying changes.')
      return
    }
    if (!modelReady) {
      setStatusText(modelError ? `The AI model needs to be retried: ${modelError}` : 'The AI agent is still loading. Try again in a moment.')
      return
    }
    if (status !== 'idle' && status !== 'done' && status !== 'error') {
      setStatusText('The AI agent is busy. Wait for the current task to finish.')
      return
    }

    const selectedFont = FONT_STYLES.find((style) => style.value === fontStyle) ?? FONT_STYLES[0]
    const photoContext = analysis
      ? [
          `Reference image: ${imageName} (${analysis.width}×${analysis.height}, ${analysis.orientation}).`,
          `Dominant colors: ${analysis.colors.join(', ') || 'not available'}.`,
          analysis.extractedText ? `Text found in the image: “${analysis.extractedText}”.` : 'No reliable readable text was found in the image.',
        ].join('\n')
      : 'No reference image was provided.'

    const designPrompt = [
      'Apply this UI design change to the current project. Inspect the existing frontend before editing, then make the change in the relevant source files.',
      `Design direction: ${prompt.trim()}`,
      `Typography direction: ${selectedFont.label} (${selectedFont.description}). Use an appropriate web-safe or imported font and adjust hierarchy, weight, tracking, and spacing to match.`,
      photoContext,
      'Use the image only as visual inspiration unless I explicitly ask to use it as an asset. Preserve the app functionality, ensure responsive accessible UI, and explain the completed change.',
    ].join('\n\n')

    try {
      await runAgent(designPrompt)
      setStatusText('Design request completed. Review the AI Agent panel for details.')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The design request could not be started.'
      setStatusText(message)
    }
  }

  if (!isOpen) return null

  return (
    <aside className="fixed right-0 top-10 bottom-0 z-50 flex w-[420px] flex-col border-l border-border bg-panel shadow-2xl animate-slide-in-right">
      <header className="flex items-center justify-between border-b border-border bg-surface-200 px-4 py-3">
        <div>
          <h2 className="text-sm font-bold tracking-wide text-text-primary">Visual UI Builder</h2>
          <p className="mt-0.5 text-[10px] text-text-dim">Turn a reference image and prompt into code changes.</p>
        </div>
        <button
          onClick={() => setOpen(false)}
          className="rounded p-1 text-text-secondary transition-colors hover:bg-white/10 hover:text-text-primary"
          title="Close UI Builder"
          aria-label="Close UI Builder"
        >
          <X size={16} />
        </button>
      </header>

      <div className="flex-1 space-y-5 overflow-y-auto p-4">
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <ImagePlus size={14} className="text-accent-400" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-text-secondary">Reference photo</h3>
          </div>
          <p className="text-xs leading-relaxed text-text-dim">Upload a screenshot, mockup, brand reference, or photo. Its palette, proportions, and readable text shape the design brief.</p>

          {imageUrl ? (
            <div className="overflow-hidden rounded-lg border border-border bg-surface-300">
              <div className="relative aspect-[16/9] bg-surface-400">
                <img src={imageUrl} alt="Uploaded design reference" className="h-full w-full object-contain" />
                <button
                  onClick={clearImage}
                  className="absolute right-2 top-2 rounded-md border border-white/10 bg-surface-300/90 p-1.5 text-text-secondary transition-colors hover:text-error"
                  title="Remove image"
                  aria-label="Remove image"
                >
                  <Trash2 size={13} />
                </button>
              </div>
              <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2">
                <span className="truncate text-[11px] text-text-secondary">{imageName}</span>
                <button onClick={() => fileInputRef.current?.click()} className="text-[10px] font-medium text-accent-400 hover:text-accent-300">
                  Replace
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(event) => event.preventDefault()}
              onDrop={handleDrop}
              className="flex min-h-32 w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-surface-300/60 px-4 text-center transition-colors hover:border-accent-400/60 hover:bg-accent-400/5"
            >
              <span className="rounded-full bg-accent-400/10 p-2.5 text-accent-400"><Upload size={18} /></span>
              <span className="text-xs font-medium text-text-secondary">Drop a photo here or choose a file</span>
              <span className="text-[10px] text-text-dim">PNG, JPG, WEBP, GIF · up to 12 MB</span>
            </button>
          )}
          <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileChange} className="hidden" />
        </section>

        {(isAnalyzing || analysis) && (
          <section className="rounded-lg border border-border bg-surface-300 p-3">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-text-secondary">
              {isAnalyzing ? <Loader2 size={13} className="animate-spin text-accent-400" /> : <Sparkles size={13} className="text-accent-400" />}
              {isAnalyzing ? 'Reading reference…' : 'Visual analysis'}
            </div>
            {analysis && (
              <div className="space-y-2 text-[11px] text-text-dim">
                <div className="flex items-center justify-between"><span>Layout</span><span className="text-text-secondary">{analysis.width} × {analysis.height} · {analysis.orientation}</span></div>
                <div className="flex items-center justify-between gap-3">
                  <span className="shrink-0">Palette</span>
                  <div className="flex gap-1.5">{analysis.colors.map((color) => <span key={color} title={color} className="h-4 w-4 rounded-full border border-white/10" style={{ backgroundColor: color }} />)}</div>
                </div>
                {analysis.extractedText && <p className="border-t border-border pt-2 leading-relaxed"><FileText size={11} className="mr-1 inline text-accent-400" />“{analysis.extractedText}”</p>}
              </div>
            )}
          </section>
        )}

        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <Type size={14} className="text-primary-300" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-text-secondary">Typography style</h3>
          </div>
          <select value={fontStyle} onChange={(event) => setFontStyle(event.target.value)} className="w-full rounded-lg border border-border bg-surface-300 px-3 py-2 text-xs text-text-primary outline-none transition-colors focus:border-primary-400/60">
            {FONT_STYLES.map((style) => <option key={style.value} value={style.value}>{style.label} — {style.description}</option>)}
          </select>
        </section>

        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <Palette size={14} className="text-primary-300" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-text-secondary">Describe the change</h3>
          </div>
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={5}
            placeholder="Example: Make the landing page feel like this reference. Use large editorial headlines, a warm neutral palette, rounded cards, and improve the CTA hierarchy."
            className="w-full resize-none rounded-lg border border-border bg-surface-300 px-3 py-2.5 text-xs leading-relaxed text-text-primary outline-none transition-colors placeholder:text-text-dim focus:border-primary-400/60"
          />
        </section>

        {statusText && <p className="rounded-md border border-border/70 bg-surface-300 px-3 py-2 text-[11px] leading-relaxed text-text-secondary">{statusText}</p>}
      </div>

      <footer className="border-t border-border bg-surface-200 p-4">
        <button
          onClick={() => void submitDesignRequest()}
          disabled={isAnalyzing || !prompt.trim() || !modelReady || (status !== 'idle' && status !== 'done' && status !== 'error')}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary-500 px-4 py-2.5 text-xs font-semibold text-white shadow-lg shadow-primary-500/20 transition-colors hover:bg-primary-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Send size={14} />
          Apply design with AI
        </button>
      </footer>
    </aside>
  )
}
