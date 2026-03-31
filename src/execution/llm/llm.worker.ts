// ============================================================
// EXECUTION LAYER: LLM WebWorker
// Runs @mlc-ai/web-llm in isolation off the main thread.
// Model is cached in IndexedDB by web-llm automatically.
// ============================================================

import { MLCEngine } from '@mlc-ai/web-llm'

let engine: MLCEngine | null = null
let currentModel: string | null = null
let currentAbortController: AbortController | null = null

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
      break
  }
}

async function handleInit(modelName: string) {
  try {
    // If engine is already loaded with the requested model, just emit ready
    if (engine && currentModel === modelName) {
      self.postMessage({ type: 'ready' })
      return
    }

    if (!engine) {
      engine = new MLCEngine()
    }

    engine.setInitProgressCallback((report) => {
      self.postMessage({
        type: 'progress',
        progress: report.progress,
        text: report.text,
      })
    })

    // reload() uses WebLLM's internal MLCEngine caching logic 
    // which persists weight blocks in IndexedDB.
    await engine.reload(modelName)
    currentModel = modelName
    self.postMessage({ type: 'ready' })
  } catch (err) {
    self.postMessage({
      type: 'error',
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

async function handleGenerate(data: {
  requestId: string
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[]
  maxTokens: number
  temperature: number
}) {
  if (!engine) {
    self.postMessage({ type: 'error', requestId: data.requestId, error: 'Engine not initialized' })
    return
  }

  // Create absolute fresh abort controller for this request
  currentAbortController = new AbortController()
  const signal = currentAbortController.signal

  try {
    let fullText = ''

    const chunks = await engine.chat.completions.create({
      messages: data.messages,
      max_tokens: data.maxTokens,
      temperature: data.temperature,
      stream: true
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
