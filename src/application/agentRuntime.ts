// ============================================================
// APPLICATION LAYER: shared AI-agent runtime
// Keeps the model and agent alive even when the visible panel is closed.
// ============================================================

import { useAgentStore } from './store'
import { buildAgentTools } from './agentTools'
import { AgentService } from '@/core/services/AgentService'
import { localModelProvider } from '@/execution/llm/LocalModelProvider'

let agentService: AgentService | null = null
let bootstrapPromise: Promise<AgentService> | null = null
let subscriptionsAttached = false

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The local AI model could not be loaded.'
}

function attachStoreSubscriptions(service: AgentService): void {
  if (subscriptionsAttached) return
  subscriptionsAttached = true

  localModelProvider.onLoadProgress((progress, text) => {
    useAgentStore.getState().setModelProgress(progress, text)
  })
  service.onStatusChange((status) => useAgentStore.getState().setStatus(status))
  service.onPlanUpdate((plan) => useAgentStore.getState().setPlan(plan))
  service.onMessage((message, role) => {
    const store = useAgentStore.getState()
    if (role === 'assistant') {
      if (message === '') store.startAssistantMessage()
      else store.appendToLastAssistantMessage(message)
    } else {
      store.addMessage(role, message)
    }
  })
}

export async function initializeAgentRuntime(): Promise<AgentService> {
  if (agentService) return agentService
  if (bootstrapPromise) return bootstrapPromise

  bootstrapPromise = (async () => {
    const service = new AgentService(localModelProvider)
    buildAgentTools().forEach((tool) => service.registerTool(tool))
    attachStoreSubscriptions(service)
    agentService = service

    const store = useAgentStore.getState()
    store.setModelError(null)
    try {
      await localModelProvider.initialize()
      store.setModelReady(true)
      store.setModelError(null)
    } catch (error) {
      // A user can choose another model while the initial default is loading.
      // The replacement load owns the visible progress/error state.
      if (errorMessage(error) === 'The selected model changed. Please send the request again.') {
        store.setModelReady(false)
        return service
      }
      store.setModelReady(false)
      store.setModelError(errorMessage(error))
    }

    return service
  })()

  return bootstrapPromise
}

export async function retryLocalModel(): Promise<void> {
  await initializeAgentRuntime()
  const store = useAgentStore.getState()
  store.setModelReady(false)
  store.setModelError(null)
  store.setModelProgress(0, 'Retrying the local AI model…')

  try {
    await localModelProvider.initialize()
    store.setModelReady(true)
    store.setModelError(null)
  } catch (error) {
    store.setModelReady(false)
    store.setModelError(errorMessage(error))
    throw error
  }
}

export async function runAgent(prompt: string): Promise<void> {
  const service = await initializeAgentRuntime()
  const store = useAgentStore.getState()

  if (!localModelProvider.isReady()) await retryLocalModel()
  if (store.status !== 'idle' && store.status !== 'done' && store.status !== 'error') {
    throw new Error('The AI agent is already working on another request.')
  }

  await service.start(prompt)
}
