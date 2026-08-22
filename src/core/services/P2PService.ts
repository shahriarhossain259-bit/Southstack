import type { TransportLayer } from '@/core/interfaces/IModelProvider'

export type P2PConnectionState =
  | 'idle'
  | 'creating-offer'
  | 'waiting-for-answer'
  | 'joining'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'error'

interface SignalEnvelope {
  version: 1
  description: RTCSessionDescriptionInit
}

export interface P2PMessage {
  peerId: string
  payload: unknown
  timestamp: number
}

export interface P2PState {
  state: P2PConnectionState
  detail: string
  peerId: string | null
}

const PEER_ID = 'design-peer'

function encodeSignal(signal: SignalEnvelope): string {
  const json = JSON.stringify(signal)
  const bytes = new TextEncoder().encode(json)
  let binary = ''
  bytes.forEach((byte) => { binary += String.fromCharCode(byte) })
  return btoa(binary)
}

function decodeSignal(encodedSignal: string): SignalEnvelope {
  const value = encodedSignal.trim()
  if (!value) throw new Error('Paste an invitation or answer first.')

  try {
    const json = value.startsWith('{')
      ? value
      : new TextDecoder().decode(Uint8Array.from(atob(value), (character) => character.charCodeAt(0)))
    const parsed = JSON.parse(json) as Partial<SignalEnvelope>
    if (parsed.version !== 1 || !parsed.description?.type || !parsed.description.sdp) {
      throw new Error('The connection code is incomplete or not supported.')
    }
    return parsed as SignalEnvelope
  } catch (error) {
    if (error instanceof Error && error.message === 'The connection code is incomplete or not supported.') throw error
    throw new Error('That does not look like a valid connection code.')
  }
}

/**
 * A small WebRTC data-channel transport. It uses manual offer/answer exchange,
 * so it does not require a proprietary signaling server or shared credentials.
 */
export class P2PService implements TransportLayer {
  private connection: RTCPeerConnection | null = null
  private channel: RTCDataChannel | null = null
  private state: P2PState = { state: 'idle', detail: 'Create or join a peer connection.', peerId: null }
  private stateListeners = new Set<(state: P2PState) => void>()
  private messageListeners = new Set<(message: P2PMessage) => void>()
  private receiveQueue: P2PMessage[] = []
  private receiveWaiters: Array<(result: IteratorResult<{ peerId: string; payload: unknown }>) => void> = []

  async createOffer(): Promise<string> {
    this.close()
    this.setState('creating-offer', 'Creating a secure connection invitation…')
    const connection = this.createConnection()
    this.configureChannel(connection.createDataChannel('southstack-collaboration', { ordered: true }))

    try {
      const offer = await connection.createOffer()
      await connection.setLocalDescription(offer)
      await this.waitForIceGathering(connection)
      this.setState('waiting-for-answer', 'Invitation ready. Send it to your collaborator, then paste their answer.')
      return encodeSignal({ version: 1, description: connection.localDescription!.toJSON() })
    } catch (error) {
      this.handleError(error)
      throw error
    }
  }

  async acceptOffer(offerCode: string): Promise<string> {
    this.close()
    this.setState('joining', 'Joining the peer connection…')
    const signal = decodeSignal(offerCode)
    if (signal.description.type !== 'offer') throw new Error('This code is not a connection invitation.')

    const connection = this.createConnection()
    try {
      await connection.setRemoteDescription(signal.description)
      const answer = await connection.createAnswer()
      await connection.setLocalDescription(answer)
      await this.waitForIceGathering(connection)
      this.setState('connecting', 'Answer ready. Send it back to the host to finish connecting.')
      return encodeSignal({ version: 1, description: connection.localDescription!.toJSON() })
    } catch (error) {
      this.handleError(error)
      throw error
    }
  }

  async acceptAnswer(answerCode: string): Promise<void> {
    if (!this.connection) throw new Error('Create an invitation before accepting an answer.')
    const signal = decodeSignal(answerCode)
    if (signal.description.type !== 'answer') throw new Error('This code is not a connection answer.')

    try {
      this.setState('connecting', 'Connecting to your collaborator…')
      await this.connection.setRemoteDescription(signal.description)
    } catch (error) {
      this.handleError(error)
      throw error
    }
  }

  async send(peerId: string, payload: unknown): Promise<void> {
    if (peerId !== PEER_ID || this.channel?.readyState !== 'open') {
      throw new Error('No connected peer is available.')
    }
    this.channel.send(JSON.stringify(payload))
  }

  getPeers(): string[] {
    return this.channel?.readyState === 'open' ? [PEER_ID] : []
  }

  subscribe(listener: (state: P2PState) => void): () => void {
    this.stateListeners.add(listener)
    listener(this.state)
    return () => this.stateListeners.delete(listener)
  }

  onMessage(listener: (message: P2PMessage) => void): () => void {
    this.messageListeners.add(listener)
    return () => this.messageListeners.delete(listener)
  }

  close(): void {
    this.channel?.close()
    this.connection?.close()
    this.channel = null
    this.connection = null
    if (this.state.state !== 'idle') this.setState('disconnected', 'Peer connection closed.')
  }

  async *receive(): AsyncIterable<{ peerId: string; payload: unknown }> {
    while (true) {
      const queued = this.receiveQueue.shift()
      if (queued) {
        yield { peerId: queued.peerId, payload: queued.payload }
        continue
      }

      const next = await new Promise<IteratorResult<{ peerId: string; payload: unknown }>>((resolve) => {
        this.receiveWaiters.push(resolve)
      })
      if (next.done) return
      yield next.value
    }
  }

  private createConnection(): RTCPeerConnection {
    if (!('RTCPeerConnection' in window)) {
      const error = new Error('WebRTC is not supported in this browser.')
      this.handleError(error)
      throw error
    }

    const connection = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun.cloudflare.com:3478' },
      ],
    })
    this.connection = connection

    connection.ondatachannel = (event) => this.configureChannel(event.channel)
    connection.onconnectionstatechange = () => {
      switch (connection.connectionState) {
        case 'connected':
          this.setState('connected', 'Connected directly to your collaborator.', PEER_ID)
          break
        case 'connecting':
          this.setState('connecting', 'Connecting to your collaborator…')
          break
        case 'disconnected':
          this.setState('disconnected', 'Connection interrupted. It may reconnect automatically.')
          break
        case 'failed':
          this.setState('error', 'Connection failed. Try creating a new invitation.')
          break
        case 'closed':
          if (this.state.state !== 'disconnected') this.setState('disconnected', 'Peer connection closed.')
          break
      }
    }
    connection.onicecandidateerror = () => {
      if (connection.connectionState === 'failed') this.setState('error', 'A network candidate could not be reached.')
    }

    return connection
  }

  private configureChannel(channel: RTCDataChannel): void {
    this.channel = channel
    channel.onopen = () => this.setState('connected', 'Connected directly to your collaborator.', PEER_ID)
    channel.onclose = () => {
      if (this.state.state === 'connected') this.setState('disconnected', 'Peer channel closed.')
    }
    channel.onerror = () => this.setState('error', 'The peer data channel encountered an error.')
    channel.onmessage = (event) => {
      let payload: unknown = event.data
      try {
        payload = JSON.parse(event.data as string) as unknown
      } catch {
        // Keep a non-JSON message usable for backwards-compatible peer clients.
      }
      const message = { peerId: PEER_ID, payload, timestamp: Date.now() }
      const waiter = this.receiveWaiters.shift()
      if (waiter) waiter({ done: false, value: { peerId: message.peerId, payload: message.payload } })
      else this.receiveQueue.push(message)
      this.messageListeners.forEach((listener) => listener(message))
    }
  }

  private async waitForIceGathering(connection: RTCPeerConnection): Promise<void> {
    if (connection.iceGatheringState === 'complete') return
    await new Promise<void>((resolve) => {
      const timeout = window.setTimeout(finish, 10_000)
      function finish() {
        window.clearTimeout(timeout)
        connection.removeEventListener('icegatheringstatechange', onStateChange)
        resolve()
      }
      function onStateChange() {
        if (connection.iceGatheringState === 'complete') finish()
      }
      connection.addEventListener('icegatheringstatechange', onStateChange)
    })
  }

  private setState(state: P2PConnectionState, detail: string, peerId: string | null = null): void {
    this.state = { state, detail, peerId }
    this.stateListeners.forEach((listener) => listener(this.state))
  }

  private handleError(error: unknown): void {
    const detail = error instanceof Error ? error.message : 'Unexpected peer connection error.'
    this.setState('error', detail)
  }
}

export const p2pService = new P2PService()
