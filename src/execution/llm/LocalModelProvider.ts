// ============================================================
// EXECUTION LAYER: LocalModelProvider
// Uses @mlc-ai/web-llm. Model is loaded once, cached in IDB.
// Runs inside a WebWorker to never block the UI thread.
// ============================================================

import type { ModelProvider, ModelGenerateOptions, ChatMessage } from '@/core/interfaces/IModelProvider'

// We use web-llm's MLCEngine directly in a worker via postMessage bridge.
// This file is the MAIN THREAD PROXY — it talks to the worker.

// Use the smaller general model by default so a first-time local setup gets a
// reliable response on typical integrated GPUs. The 3B coding model remains
// available from the selector for devices with more GPU memory.
export const DEFAULT_MODEL = 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC'
const GENERATION_TIMEOUT_MS = 120_000

export interface LocalModelOption {
  id: string
  label: string
  description: string
}

// All of these model IDs are included in WebLLM's bundled model registry.
// Keeping the choices conservative makes the selector dependable across a
// wider range of WebGPU-capable laptops.
export const LOCAL_MODEL_OPTIONS: readonly LocalModelOption[] = [
  {
    id: 'Qwen2.5-Coder-3B-Instruct-q4f16_1-MLC',
    label: 'Qwen2.5 Coder 3B',
    description: 'Best coding quality; needs more GPU memory',
  },
  {
    id: DEFAULT_MODEL,
    label: 'Qwen2.5 1.5B',
    description: 'Balanced speed and instruction following',
  },
  {
    id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',
    label: 'Llama 3.2 1B',
    description: 'Fastest option for lower-memory devices',
  },
]

const MODEL_STORAGE_KEY = 'southstack.local-model'
const MODEL_STORAGE_VERSION_KEY = 'southstack.local-model-version'
const MODEL_STORAGE_VERSION = '2'

function getInitialModel(): string {
  if (typeof window === 'undefined') return DEFAULT_MODEL

  try {
    // Version 2 switched the first-run default from the memory-hungry 3B
    // model to Qwen 1.5B. Do not keep an incompatible pre-update selection
    // that can prevent the agent from ever reaching its ready state.
    if (window.localStorage.getItem(MODEL_STORAGE_VERSION_KEY) !== MODEL_STORAGE_VERSION) {
      window.localStorage.setItem(MODEL_STORAGE_VERSION_KEY, MODEL_STORAGE_VERSION)
      window.localStorage.removeItem(MODEL_STORAGE_KEY)
      return DEFAULT_MODEL
    }

    const storedModel = window.localStorage.getItem(MODEL_STORAGE_KEY)
    return LOCAL_MODEL_OPTIONS.some((model) => model.id === storedModel)
      ? storedModel!
      : DEFAULT_MODEL
  } catch {
    // Local storage can be blocked in embedded/private browser contexts.
    return DEFAULT_MODEL
  }
}

export class LocalModelProvider implements ModelProvider {
  private worker: Worker | null = null
  private ready = false
  private loadProgress = 0
  private modelName = getInitialModel()
  private initializationPromise: Promise<void> | null = null
  private resolveInitialization: (() => void) | null = null
  private rejectInitialization: ((error: Error) => void) | null = null
  private pendingResolvers: Map<string, {
    resolve: (v: string) => void
    reject: (e: Error) => void
    onToken?: (t: string) => void
    timeoutId: ReturnType<typeof setTimeout>
  }> = new Map()
  private progressListeners: Set<(progress: number, text: string) => void> = new Set()

  private _isDisposedError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error ?? '')
    return /already been disposed/i.test(message)
  }

  private _rejectPending(error: Error): void {
    this.pendingResolvers.forEach(({ reject, timeoutId }) => {
      clearTimeout(timeoutId)
      reject(error)
    })
    this.pendingResolvers.clear()
  }

  private _resetWorker(reason = 'The local model was restarted. Please try again.'): void {
    const worker = this.worker
    this.rejectInitialization?.(new Error(reason))
    if (!worker) {
      this.ready = false
      this.loadProgress = 0
      this._rejectPending(new Error(reason))
      this.initializationPromise = null
      this.resolveInitialization = null
      this.rejectInitialization = null
      return
    }

    worker.onmessage = null
    worker.onerror = null
    worker.terminate()
    this.worker = null
    this.ready = false
    this.loadProgress = 0
    this._rejectPending(new Error(reason))
    this.initializationPromise = null
    this.resolveInitialization = null
    this.rejectInitialization = null
  }

  async initialize(): Promise<void> {
    if (this.ready && this.worker) return
    if (this.initializationPromise) return this.initializationPromise

    this.ready = false
    this.loadProgress = 0

    if (this.worker) {
      this._resetWorker()
    }

    const worker = new Worker(new URL('./llm.worker.ts', import.meta.url), { type: 'module' })
    this.worker = worker

    this.initializationPromise = new Promise<void>((resolve, reject) => {
      this.resolveInitialization = resolve
      this.rejectInitialization = reject
    })

    worker.onmessage = (e) => this._handleMessage(e.data)
    worker.onerror = (e) => {
      const error = new Error(e.message || 'Model worker failed')
      if (this._isDisposedError(error)) {
        this._failInitialization(error)
        this._resetWorker(error.message)
        return
      }
      this._failInitialization(error)
      this._rejectPending(error)
    }
    worker.postMessage({ type: 'init', modelName: this.modelName })

    return this.initializationPromise
  }

  async generate(messages: ChatMessage[], options?: ModelGenerateOptions): Promise<string> {
    return this.generateStream(messages, options?.onToken ?? (() => { }), options)
  }

  async generateStream(
    messages: ChatMessage[],
    onToken: (token: string) => void,
    options?: ModelGenerateOptions
  ): Promise<string> {
    // Keep callers behind the initialization barrier even if they start a
    // request during the UI's loading transition.
    if (this.initializationPromise) await this.initializationPromise
    if (!this.worker || !this.ready) {
      await this.initialize()
    }

    const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2)}`
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        const pendingRequest = this.pendingResolvers.get(requestId)
        if (!pendingRequest) return

        this.pendingResolvers.delete(requestId)
        this.worker?.postMessage({ type: 'abort' })
        pendingRequest.reject(new Error('The local model took too long to respond. Try the faster 1.5B or Llama model, then resend your request.'))
      }, GENERATION_TIMEOUT_MS)

      this.pendingResolvers.set(requestId, { resolve, reject, onToken, timeoutId })
      this.worker!.postMessage({
        type: 'generate',
        requestId,
        messages,
        maxTokens: options?.maxTokens ?? 512,
        temperature: options?.temperature ?? 0.2,
      })
    })
  }

  abort(): void {
    this._rejectPending(new Error('Generation stopped.'))
    if (this.worker) {
      this.worker.postMessage({ type: 'abort' })
    }
  }

  isReady(): boolean { return this.ready }
  getModelName(): string { return this.modelName }
  getLoadProgress(): number { return this.loadProgress }

  async setModelName(modelName: string): Promise<void> {
    if (!LOCAL_MODEL_OPTIONS.some((model) => model.id === modelName)) {
      throw new Error('That local model is not supported by Southstack.')
    }
    if (modelName === this.modelName && this.ready) return

    const previousModel = this.modelName
    this.modelName = modelName
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(MODEL_STORAGE_KEY, modelName)
        window.localStorage.setItem(MODEL_STORAGE_VERSION_KEY, MODEL_STORAGE_VERSION)
      } catch {
        // The chosen model still works for this session without persistence.
      }
    }

    this._resetWorker('The selected model changed. Please send the request again.')
    try {
      await this.initialize()
    } catch (error) {
      // Keep the previous, known-good selection as the next retry target when
      // a larger model cannot be allocated by the current GPU.
      this.modelName = previousModel
      throw error
    }
  }

  dispose(): void {
    this._resetWorker('Model provider disposed')
  }

  onLoadProgress(cb: (progress: number, text: string) => void): () => void {
    this.progressListeners.add(cb)
    return () => this.progressListeners.delete(cb)
  }

  private _handleMessage(data: Record<string, unknown>): void {
    switch (data.type) {
      case 'ready':
        this.ready = true
        this.loadProgress = 1
        this._resolveInitialization()
        break

      case 'progress':
        this.loadProgress = data.progress as number
        this.progressListeners.forEach((cb) => cb(data.progress as number, data.text as string))
        break

      case 'error': {
        const message = data.error as string | undefined
        if (message && this._isDisposedError(message)) {
          const error = new Error(message)
          this._failInitialization(error)
          this._resetWorker(message)
          return
        }

        const resolver = this.pendingResolvers.get(data.requestId as string)
        if (resolver) {
          this.pendingResolvers.delete(data.requestId as string)
          clearTimeout(resolver.timeoutId)
          resolver.reject(new Error(message ?? 'Unknown model error'))
        } else if (!data.requestId) {
          this._failInitialization(new Error(message ?? 'Model worker failed'))
        }
        break
      }

      case 'token': {
        const resolver = this.pendingResolvers.get(data.requestId as string)
        resolver?.onToken?.(data.token as string)
        break
      }

      case 'result': {
        const resolver = this.pendingResolvers.get(data.requestId as string)
        if (resolver) {
          this.pendingResolvers.delete(data.requestId as string)
          clearTimeout(resolver.timeoutId)
          resolver.resolve(data.text as string)
        }
        break
      }

    }
  }

  private _resolveInitialization(): void {
    this.resolveInitialization?.()
    this.resolveInitialization = null
    this.rejectInitialization = null
  }

  private _failInitialization(error: Error): void {
    this.ready = false
    this.rejectInitialization?.(error)
    this.resolveInitialization = null
    this.rejectInitialization = null
    this.initializationPromise = null
  }
}

export const localModelProvider = new LocalModelProvider()
