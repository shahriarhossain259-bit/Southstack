// ============================================================
// UI LAYER: AgentPanel — AI chat, plan, execution log
// ============================================================

import { useState, useRef, useEffect } from 'react'
import {
  Send, Bot, Loader2, CheckCircle2, XCircle,
  AlertCircle, Clock, Zap, ChevronDown, ChevronUp,
  Square, Copy, Check
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { useAgentStore } from '@/application/store'
import type { AgentStatus, AgentStep } from '@/core/interfaces/IAgentService'
import { initializeAgentRuntime, retryLocalModel, runAgent } from '@/application/agentRuntime'
import { LOCAL_MODEL_OPTIONS, localModelProvider } from '@/execution/llm/LocalModelProvider'
import type { AgentService } from '@/core/services/AgentService'

function StatusBadge({ status }: { status: AgentStatus }) {
  const config: Record<AgentStatus, { label: string; color: string; icon: React.ReactNode }> = {
    idle: { label: 'Idle', color: 'text-text-dim', icon: <Clock size={10} /> },
    planning: { label: 'Planning', color: 'text-accent-400', icon: <Loader2 size={10} className="animate-spin" /> },
    executing: { label: 'Executing', color: 'text-warning', icon: <Zap size={10} /> },
    reflecting: { label: 'Reflecting', color: 'text-primary-300', icon: <Loader2 size={10} className="animate-spin" /> },
    done: { label: 'Done', color: 'text-success', icon: <CheckCircle2 size={10} /> },
    error: { label: 'Error', color: 'text-error', icon: <XCircle size={10} /> },
  }
  const cfg = config[status]
  return (
    <div className={`flex items-center gap-1 text-xs ${cfg.color}`}>
      {cfg.icon}
      <span>{cfg.label}</span>
    </div>
  )
}

function PlanStep({ step, index }: { step: AgentStep; index: number }) {
  const icons = {
    pending: <Clock size={11} className="text-text-dim" />,
    running: <Loader2 size={11} className="text-warning animate-spin" />,
    done: <CheckCircle2 size={11} className="text-success" />,
    error: <XCircle size={11} className="text-error" />,
  }
  return (
    <div className={`flex items-start gap-2 py-1.5 px-2 rounded text-xs transition-colors ${
      step.status === 'running' ? 'bg-warning/10 border border-warning/20' :
      step.status === 'done' ? 'bg-success/5' :
      step.status === 'error' ? 'bg-error/10 border border-error/20' : ''
    }`}>
      <div className="mt-0.5 flex-shrink-0">{icons[step.status]}</div>
      <div className="flex-1 min-w-0">
        <div className={`${step.status === 'done' ? 'text-text-dim line-through' : 'text-text-secondary'}`}>
          <span className="text-text-dim mr-1">{index + 1}.</span>
          {step.description}
        </div>
        {step.action && (
          <div className="mt-0.5 font-mono text-[10px] text-accent-400/80">
            → {step.action.tool}({JSON.stringify(step.action.input || {}).slice(0, 60)})
          </div>
        )}
        {step.error && (
          <div className="mt-0.5 text-error text-[10px]">✗ {step.error}</div>
        )}
      </div>
    </div>
  )
}

interface ChatMessageProps {
  role: 'user' | 'assistant'
  content: string
}

function CodeBlock({ language, value }: { language: string; value: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="group relative my-3 rounded-md overflow-hidden border border-border/40">
      <div className="flex items-center justify-between px-3 py-1.5 bg-surface-300 border-b border-border/40">
        <span className="text-[10px] text-text-dim font-mono uppercase">{language || 'code'}</span>
        <button
          onClick={handleCopy}
          className="p-1 hover:bg-white/5 rounded transition-colors text-text-dim hover:text-text-primary"
          title="Copy code"
        >
          {copied ? <Check size={12} className="text-success" /> : <Copy size={12} />}
        </button>
      </div>
      <SyntaxHighlighter
        language={language || 'text'}
        style={vscDarkPlus}
        customStyle={{
          margin: 0,
          padding: '12px',
          fontSize: '11px',
          lineHeight: '1.6',
          backgroundColor: 'transparent',
        }}
      >
        {value}
      </SyntaxHighlighter>
    </div>
  )
}

function ChatMessage({ role, content }: ChatMessageProps) {
  const displayContent = role === 'assistant' ? getAssistantDisplayContent(content) : content

  if (!displayContent && role === 'assistant') return null;

  return (
    <div className={`flex gap-3 animate-fade-in ${role === 'user' ? 'justify-end' : 'justify-start'}`}>
      {role === 'assistant' && (
        <div className="w-6 h-6 rounded-full bg-primary-500/30 border border-primary-400/30 flex items-center justify-center flex-shrink-0 mt-0.5 shadow-lg shadow-primary-500/10">
          <Bot size={12} className="text-primary-300" />
        </div>
      )}
      <div className={`max-w-[90%] rounded-xl px-4 py-2.5 text-[11px] leading-relaxed shadow-sm ${
        role === 'user'
          ? 'bg-primary-500/20 border border-primary-400/20 text-text-primary'
          : 'bg-surface-200 border border-border text-text-secondary'
      }`}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            code({ node, inline, className, children, ...props }: any) {
              const match = /language-(\w+)/.exec(className || '')
              return !inline && match ? (
                <CodeBlock
                  language={match[1]}
                  value={String(children).replace(/\n$/, '')}
                />
              ) : (
                <code className="px-1.5 py-0.5 rounded bg-surface-300 text-primary-300 font-mono text-[10px]" {...props}>
                  {children}
                </code>
              )
            },
            p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
            ul: ({ children }) => <ul className="list-disc ml-4 mb-2 space-y-1">{children}</ul>,
            ol: ({ children }) => <ol className="list-decimal ml-4 mb-2 space-y-1">{children}</ol>,
            li: ({ children }) => <li>{children}</li>,
            strong: ({ children }) => <strong className="font-semibold text-text-primary">{children}</strong>,
            h1: ({ children }) => <h1 className="text-sm font-bold mt-4 mb-2 text-text-primary border-b border-border pb-1">{children}</h1>,
            h2: ({ children }) => <h2 className="text-xs font-bold mt-4 mb-2 text-text-primary">{children}</h2>,
          }}
        >
          {displayContent}
        </ReactMarkdown>
      </div>
    </div>
  )
}

function getAssistantDisplayContent(content: string): string {
  const jsonBlock = content.match(/```json\s*([\s\S]*?)\s*```/i)?.[1]
    ?? content.match(/^\s*(\{[\s\S]*\})\s*$/)?.[1]

  if (jsonBlock) {
    try {
      const response = JSON.parse(jsonBlock) as {
        summary?: unknown
        current_step?: unknown
        action?: { tool?: unknown }
        status?: unknown
      }
      if (typeof response.summary === 'string' && response.summary.trim()) return response.summary.trim()
      if (response.status === 'done') return 'Task complete.'
      const step = typeof response.current_step === 'string' ? response.current_step.trim() : ''
      const tool = typeof response.action?.tool === 'string' ? response.action.tool.replace(/_/g, ' ') : ''
      if (step) return tool && tool !== 'none' ? `${step} (${tool})` : step
      if (tool && tool !== 'none') return `Working with ${tool}.`
      return response.status === 'error' ? 'The agent reported an error.' : 'Working on your request…'
    } catch {
      // Do not hide a malformed response from a small local model behind a
      // permanent generic status message.
      return content.trim() || 'Working on your request…'
    }
  }

  const prose = content.replace(/```json[\s\S]*$/i, '').trim()
  return prose || 'Working on your request…'
}

export function AgentPanel() {
  const {
    status, plan, messages, modelReady, modelError, modelProgress, modelProgressText,
    setModelError, setModelProgress, setModelReady
  } = useAgentStore()

  const [input, setInput] = useState('')
  const [showPlan, setShowPlan] = useState(true)
  const [selectedModel, setSelectedModel] = useState(localModelProvider.getModelName())
  const [isChangingModel, setIsChangingModel] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const [agentService, setAgentService] = useState<AgentService | null>(null)

  useEffect(() => {
    let cancelled = false

    async function bootstrap() {
      try {
        const service = await initializeAgentRuntime()
        if (!cancelled) setAgentService(service)
      } catch (err) {
        console.error('Model init failed:', err)
      }
    }
    void bootstrap()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function handleSend() {
    if (!input.trim() || !agentService) return
    const prompt = input.trim()
    setInput('')
    await runAgent(prompt)
  }

  async function retryModel() {
    setModelReady(false)
    setModelError(null)
    setModelProgress(0, 'Retrying the local AI model…')
    try {
      await retryLocalModel()
      setModelReady(true)
    } catch (err) {
      setModelError(err instanceof Error ? err.message : 'The local AI model could not be loaded.')
    }
  }

  async function changeModel(modelName: string) {
    if (modelName === localModelProvider.getModelName() && modelReady) return

    setSelectedModel(modelName)
    setIsChangingModel(true)
    setModelReady(false)
    setModelError(null)
    setModelProgress(0, 'Loading selected model…')
    try {
      await localModelProvider.setModelName(modelName)
      setModelReady(true)
      setModelError(null)
    } catch (err) {
      setModelError(err instanceof Error ? err.message : 'The selected local model could not be loaded.')
    } finally {
      setIsChangingModel(false)
    }
  }

  return (
    <div className="flex flex-col h-full bg-panel border-l border-border">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className={`w-1.5 h-1.5 rounded-full ${modelReady ? 'bg-success animate-pulse-slow' : 'bg-warning animate-pulse'}`} />
          <span className="text-xs font-semibold text-text-secondary uppercase tracking-widest">AI Agent</span>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <select
            value={selectedModel}
            onChange={(event) => void changeModel(event.target.value)}
            disabled={isChangingModel || (status !== 'idle' && status !== 'done' && status !== 'error')}
            title="Choose the local AI model"
            className="max-w-36 rounded border border-border bg-surface-300 px-1.5 py-1 text-[10px] text-text-secondary outline-none focus:border-primary-400/60 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {LOCAL_MODEL_OPTIONS.map((model) => (
              <option key={model.id} value={model.id} title={model.description}>{model.label}</option>
            ))}
          </select>
          <StatusBadge status={status} />
        </div>
      </div>

      {/* Model loading progress */}
      {!modelReady && !modelError && (
        <div className="px-3 py-2 border-b border-border flex-shrink-0">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-text-dim truncate">{modelProgressText || 'Loading model…'}</span>
            <span className="text-[10px] text-primary-300 ml-2">{Math.round(modelProgress * 100)}%</span>
          </div>
          <div className="h-1 bg-surface-300 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-primary-500 to-accent-400 rounded-full transition-all duration-300"
              style={{ width: `${modelProgress * 100}%` }}
            />
          </div>
        </div>
      )}

      {modelError && (
        <div className="flex items-center justify-between gap-3 border-b border-error/30 bg-error/5 px-3 py-2">
          <p className="min-w-0 text-[10px] leading-relaxed text-error">{modelError}</p>
          <button onClick={() => void retryModel()} className="shrink-0 rounded border border-error/40 px-2 py-1 text-[10px] font-medium text-error transition-colors hover:bg-error/10">Retry</button>
        </div>
      )}

      {/* Execution Plan */}
      {plan.length > 0 && (
        <div className="border-b border-border flex-shrink-0">
          <button
            onClick={() => setShowPlan((v) => !v)}
            className="flex items-center justify-between w-full px-3 py-2 text-xs text-text-secondary hover:text-text-primary hover:bg-white/3 transition-colors"
          >
            <span className="font-medium uppercase tracking-widest text-[10px]">Execution Plan</span>
            {showPlan ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          </button>
          {showPlan && (
            <div className="px-2 pb-2 space-y-0.5 max-h-48 overflow-y-auto">
              {plan.map((step, i) => (
                <PlanStep key={step.id} step={step} index={i} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Chat messages */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
            <div className="w-10 h-10 rounded-full bg-primary-500/20 border border-primary-400/20 flex items-center justify-center">
              <Bot size={20} className="text-primary-300" />
            </div>
            <div>
              <p className="text-xs font-medium text-text-secondary">Southstack AI</p>
              <p className="text-[11px] text-text-dim mt-1">Describe what you want to build or fix</p>
            </div>
            <div className="flex flex-wrap justify-center gap-1.5 mt-2">
              {['Fix all TypeScript errors', 'Add authentication', 'Refactor this file', 'Write unit tests'].map((s) => (
                <button
                  key={s}
                  onClick={() => setInput(s)}
                  className="px-2 py-1 text-[10px] rounded-md bg-surface-200 border border-border text-text-secondary hover:text-text-primary hover:border-primary-400/40 transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((msg) => (
          <ChatMessage key={msg.id} role={msg.role} content={msg.content} />
        ))}
        
        {/* Active Tool Badge (Cleaner "Thinking" UI) */}
        {(status === 'executing' || status === 'planning' || status === 'reflecting') && (
          <div className="flex items-start gap-3 animate-pulse-slow">
            <div className="w-6 h-6 rounded-full bg-accent-500/20 border border-accent-400/20 flex items-center justify-center flex-shrink-0 mt-0.5">
              <Zap size={10} className="text-accent-300" />
            </div>
            <div className="px-3 py-1.5 rounded-lg bg-surface-300 border border-border text-[10px] text-accent-300 font-medium flex items-center gap-2">
              <Loader2 size={10} className="animate-spin" />
              {status === 'planning' && 'Thinking...'}
              {status === 'reflecting' && 'Analyzing result...'}
              {status === 'executing' && (
                plan.find(s => s.status === 'running')?.description || 'Executing task...'
              )}
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="px-3 py-3 border-t border-border flex-shrink-0">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
            placeholder={modelReady ? 'Describe your task… (Enter to send)' : 'Loading model…'}
            disabled={!modelReady || (status !== 'idle' && status !== 'error' && status !== 'done')}
            rows={3}
            className="flex-1 bg-surface-200 border border-border rounded-lg px-3 py-2 text-xs text-text-primary placeholder:text-text-dim focus:outline-none focus:border-primary-400/50 resize-none transition-colors disabled:opacity-50 font-sans shadow-inner"
          />
          {status !== 'idle' && status !== 'done' && status !== 'error' ? (
            <button
              onClick={() => agentService?.stop()}
              className="p-2.5 bg-error/20 hover:bg-error/30 text-error rounded-lg transition-colors flex-shrink-0 border border-error/30"
              title="Stop execution"
            >
              <Square size={14} fill="currentColor" />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!modelReady || !input.trim() || (status !== 'idle' && status !== 'error' && status !== 'done')}
              className="p-2.5 bg-primary-500 hover:bg-primary-400 disabled:opacity-40 rounded-lg transition-colors flex-shrink-0 shadow-lg shadow-primary-500/20"
              title="Send (Enter)"
            >
              <Send size={14} className="text-white" />
            </button>
          )}
        </div>
        <p className="text-[10px] text-text-dim mt-1.5 text-center">
          Shift+Enter for newline • Enter to send • {LOCAL_MODEL_OPTIONS.find((model) => model.id === selectedModel)?.label ?? 'Local AI'} (offline)
        </p>
      </div>
    </div>
  )
}
