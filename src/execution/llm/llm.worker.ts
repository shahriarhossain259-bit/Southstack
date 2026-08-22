// ============================================================
// EXECUTION LAYER: LLM WebWorker
// Runs @mlc-ai/web-llm in isolation off the main thread.
// Model is cached in IndexedDB by web-llm automatically.
// ============================================================

import { CreateMLCEngine, type MLCEngine } from '@mlc-ai/web-llm'

let engine: MLCEngine | null = null
let currentModel: string | null = null
let modelLoadPromise: Promise<void> | null = null
let currentAbortController: AbortController | null = null
// Small local models are much more responsive with a bounded context. The
// application already trims the project/history before requests reach here.
const CONTEXT_WINDOW_SIZE = 2048

self.onmessage = async (e: MessageEvent) => {
  const { type, ...data } = e.data

  switch (type) {
    case 'init':
      await handleInit(data.modelName)
      break
    case 'generate':
      await handleGenerate(data)
      break
    case 'abort':
      if (currentAbortController) {
        currentAbortController.abort()
        currentAbortController = null
      }
      // AbortController only stops our token loop. Tell WebLLM to interrupt
      // the active GPU generation too so a cancelled request cannot keep the
      // engine locked for the next prompt.
      try {
        await engine?.interruptGenerate()
      } catch {
        // A request may finish between the abort event and this call.
      }
      break
  }
}

async function handleInit(modelName: string) {
  try {
    // If the requested model is already available, no reload is necessary.
    if (engine && currentModel === modelName) {
      self.postMessage({ type: 'ready' })
      return
    }

    // Multiple init messages may arrive before the first load finishes. Let
    // them share that load instead of creating competing engines.
    if (modelLoadPromise) {
      await modelLoadPromise
      if (engine && currentModel === modelName) {
        self.postMessage({ type: 'ready' })
        return
      }
    }

    modelLoadPromise = (async () => {
      // CreateMLCEngine resolves only after reload() has finished. Keeping the
      // engine assignment inside this promise prevents completions from using
      // an engine before its model is loaded.
      engine = await CreateMLCEngine(
        modelName,
        {
          initProgressCallback: (report) => {
            self.postMessage({
              type: 'progress',
              progress: report.progress,
              text: report.text,
            })
          },
        },
        { context_window_size: CONTEXT_WINDOW_SIZE },
      )
      currentModel = modelName
    })()

    await modelLoadPromise
    self.postMessage({ type: 'ready' })
  } catch (err) {
    engine = null
    currentModel = null
    self.postMessage({
      type: 'error',
      error: err instanceof Error ? err.message : String(err),
    })
  } finally {
    modelLoadPromise = null
  }
}

async function handleGenerate(data: {
  requestId: string
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[]
  maxTokens: number
  temperature: number
}) {
  // A completion can be posted immediately after init. Wait for that load
  // instead of invoking WebLLM while reload() is still in progress.
  if (modelLoadPromise) {
    try {
      await modelLoadPromise
    } catch {
      // The initialization failure is reported by handleInit.
    }
  }

  const loadedEngine = engine
  if (!loadedEngine || !currentModel) {
    self.postMessage({
      type: 'error',
      requestId: data.requestId,
      error: 'Model is not loaded. Wait for model initialization to finish and try again.',
    })
    return
  }

  // Create absolute fresh abort controller for this request
  currentAbortController = new AbortController()
  const signal = currentAbortController.signal

  try {
    let fullText = ''

    const chunks = await loadedEngine.chat.completions.create({
      messages: data.messages,
      max_tokens: Math.min(data.maxTokens, 512),
      temperature: data.temperature,
      stream: true,
    })

    for await (const chunk of chunks) {
      // Check for manual abort in case web-llm doesn't throw immediately
      if (signal.aborted) break

      const token = chunk.choices[0]?.delta?.content ?? ''
      fullText += token
      if (token) {
        self.postMessage({ type: 'token', requestId: data.requestId, token })
      }
    }

    self.postMessage({ type: 'result', requestId: data.requestId, text: fullText })
  } catch (err) {
    if ((err as Error).name === 'AbortError' || signal.aborted) {
      self.postMessage({ type: 'error', requestId: data.requestId, error: 'Generation aborted' })
    } else {
      self.postMessage({
        type: 'error',
        requestId: data.requestId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  } finally {
    currentAbortController = null
  }
}
