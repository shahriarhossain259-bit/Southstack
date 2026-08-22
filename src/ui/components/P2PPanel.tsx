import { useEffect, useState } from 'react'
import { Check, Copy, Link2, Loader2, Send, Unplug, Users } from 'lucide-react'
import { type P2PMessage, type P2PState, p2pService } from '@/core/services/P2PService'

interface P2PPanelProps {
  isOpen: boolean
  onClose: () => void
}

function connectionColor(state: P2PState['state']): string {
  if (state === 'connected') return 'bg-success'
  if (state === 'error') return 'bg-error'
  if (state === 'connecting' || state === 'creating-offer' || state === 'joining') return 'bg-warning animate-pulse'
  return 'bg-text-dim'
}

function messageContent(message: P2PMessage): string {
  if (typeof message.payload === 'object' && message.payload !== null && 'content' in message.payload) {
    const content = (message.payload as { content?: unknown }).content
    if (typeof content === 'string') return content
  }
  return typeof message.payload === 'string' ? message.payload : JSON.stringify(message.payload)
}

export function P2PPanel({ isOpen, onClose }: P2PPanelProps) {
  const [connection, setConnection] = useState<P2PState>({ state: 'idle', detail: 'Create or join a peer connection.', peerId: null })
  const [invitation, setInvitation] = useState('')
  const [remoteCode, setRemoteCode] = useState('')
  const [note, setNote] = useState('')
  const [messages, setMessages] = useState<P2PMessage[]>([])
  const [copied, setCopied] = useState(false)
  const [isWorking, setIsWorking] = useState(false)

  useEffect(() => {
    const unsubscribeState = p2pService.subscribe(setConnection)
    const unsubscribeMessages = p2pService.onMessage((message) => {
      setMessages((current) => [...current, message])
    })
    return () => {
      unsubscribeState()
      unsubscribeMessages()
    }
  }, [])

  if (!isOpen) return null

  const runConnectionAction = async (action: () => Promise<void>) => {
    setIsWorking(true)
    try {
      await action()
    } finally {
      setIsWorking(false)
    }
  }

  const createInvitation = () => runConnectionAction(async () => {
    const code = await p2pService.createOffer()
    setInvitation(code)
    setRemoteCode('')
  })

  const joinInvitation = () => runConnectionAction(async () => {
    const code = await p2pService.acceptOffer(remoteCode)
    setInvitation(code)
    setRemoteCode('')
  })

  const finishConnection = () => runConnectionAction(async () => {
    await p2pService.acceptAnswer(remoteCode)
    setRemoteCode('')
  })

  const copyInvitation = async () => {
    if (!invitation) return
    try {
      await navigator.clipboard.writeText(invitation)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }

  const sendNote = async () => {
    if (!note.trim()) return
    try {
      await p2pService.send('design-peer', { kind: 'design-note', content: note.trim() })
      setMessages((current) => [...current, { peerId: 'you', payload: { content: note.trim() }, timestamp: Date.now() }])
      setNote('')
    } catch {
      // The connection status already communicates the actionable connection state.
    }
  }

  return (
    <aside className="fixed right-0 top-10 bottom-0 z-50 flex w-[420px] flex-col border-l border-border bg-panel shadow-2xl animate-slide-in-right">
      <header className="flex items-center justify-between border-b border-border bg-surface-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${connectionColor(connection.state)}`} />
          <div>
            <h2 className="text-sm font-bold tracking-wide text-text-primary">Peer collaboration</h2>
            <p className="text-[10px] text-text-dim">Direct encrypted browser-to-browser connection.</p>
          </div>
        </div>
        <button onClick={onClose} className="rounded px-2 py-1 text-xs text-text-secondary transition-colors hover:bg-white/10 hover:text-text-primary">Close</button>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <div className="rounded-lg border border-border bg-surface-300 p-3 text-[11px] leading-relaxed text-text-secondary">
          <div className="mb-1 flex items-center gap-2 font-semibold text-text-primary"><Users size={13} className="text-accent-400" /> {connection.state === 'connected' ? 'Peer connected' : 'Connection setup'}</div>
          {connection.detail}
        </div>

        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-text-secondary">1. Start or join</h3>
            {isWorking && <Loader2 size={13} className="animate-spin text-accent-400" />}
          </div>
          <p className="text-[11px] leading-relaxed text-text-dim">One person creates an invitation. The other pastes it below and sends their generated answer back.</p>
          <button onClick={createInvitation} disabled={isWorking} className="flex w-full items-center justify-center gap-2 rounded-lg border border-accent-400/40 bg-accent-400/10 px-3 py-2 text-xs font-medium text-accent-300 transition-colors hover:bg-accent-400/20 disabled:opacity-40">
            <Link2 size={14} /> Create invitation
          </button>
        </section>

        {invitation && (
          <section className="space-y-2 rounded-lg border border-primary-400/25 bg-primary-500/5 p-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-xs font-semibold text-text-secondary">Your code to share</h3>
              <button onClick={copyInvitation} className="flex items-center gap-1 rounded px-1.5 py-1 text-[10px] text-accent-400 hover:bg-white/5 hover:text-accent-300">
                {copied ? <Check size={12} /> : <Copy size={12} />}{copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <textarea readOnly value={invitation} rows={3} className="w-full resize-none rounded border border-border bg-surface-400 p-2 font-mono text-[9px] text-text-dim outline-none" />
          </section>
        )}

        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-text-secondary">2. Paste a peer code</h3>
          <textarea value={remoteCode} onChange={(event) => setRemoteCode(event.target.value)} rows={4} placeholder="Paste an invitation to join, or paste an answer after creating an invitation…" className="w-full resize-none rounded-lg border border-border bg-surface-300 p-2.5 font-mono text-[10px] text-text-primary outline-none placeholder:font-sans placeholder:text-text-dim focus:border-primary-400/60" />
          <div className="grid grid-cols-2 gap-2">
            <button onClick={joinInvitation} disabled={isWorking || !remoteCode.trim()} className="rounded-lg border border-border bg-surface-300 px-3 py-2 text-xs text-text-secondary transition-colors hover:border-accent-400/50 hover:text-text-primary disabled:opacity-40">Join invitation</button>
            <button onClick={finishConnection} disabled={isWorking || !remoteCode.trim() || connection.state !== 'waiting-for-answer'} className="rounded-lg bg-primary-500 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-primary-400 disabled:opacity-40">Use answer</button>
          </div>
        </section>

        {connection.state === 'connected' && (
          <section className="space-y-2 border-t border-border pt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-text-secondary">Design notes</h3>
            <div className="max-h-36 space-y-1.5 overflow-y-auto rounded-lg border border-border bg-surface-300 p-2">
              {messages.length === 0 ? <p className="px-1 py-2 text-[11px] text-text-dim">Send a note to confirm the connection.</p> : messages.map((message) => <p key={`${message.timestamp}-${message.peerId}`} className="rounded bg-surface-200 px-2 py-1.5 text-[11px] text-text-secondary"><span className="mr-1 text-accent-400">{message.peerId === 'you' ? 'You' : 'Peer'}:</span>{messageContent(message)}</p>)}
            </div>
            <div className="flex gap-2">
              <input value={note} onChange={(event) => setNote(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void sendNote() } }} placeholder="Share a design note…" className="min-w-0 flex-1 rounded-lg border border-border bg-surface-300 px-3 py-2 text-xs text-text-primary outline-none placeholder:text-text-dim focus:border-primary-400/60" />
              <button onClick={() => void sendNote()} disabled={!note.trim()} className="rounded-lg bg-primary-500 p-2 text-white transition-colors hover:bg-primary-400 disabled:opacity-40" title="Send note"><Send size={14} /></button>
            </div>
          </section>
        )}
      </div>

      <footer className="border-t border-border bg-surface-200 p-3">
        <button onClick={() => p2pService.close()} disabled={connection.state === 'idle' || connection.state === 'disconnected'} className="flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs text-text-secondary transition-colors hover:bg-error/10 hover:text-error disabled:opacity-40"><Unplug size={13} />Disconnect peer</button>
      </footer>
    </aside>
  )
}
