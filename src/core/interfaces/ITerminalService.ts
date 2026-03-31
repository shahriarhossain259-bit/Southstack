// ============================================================
// CORE SERVICES LAYER: Terminal + Runtime interfaces
// ============================================================

export type SupportedRuntime = 'node' | 'python' | 'php' | 'go' | 'shell'

export interface RuntimeCapabilities {
  canInstallPackages: boolean
  canAccessNetwork: boolean
  languages: SupportedRuntime[]
}

export interface ITerminalSession {
  id: string
  runtime: SupportedRuntime
  write(data: string): void
  onData(cb: (data: string) => void): () => void
  onExit(cb: (code: number) => void): () => void
  dispose(): void
}

export interface ITerminalService {
  createSession(runtime: SupportedRuntime): Promise<ITerminalSession>
  getSession(id: string): ITerminalSession | undefined
  closeSession(id: string): void
  getAllSessions(): ITerminalSession[]
}

export interface IRuntimeService {
  getCapabilities(runtime: SupportedRuntime): RuntimeCapabilities
  execute(runtime: SupportedRuntime, command: string): Promise<{ stdout: string; stderr: string; exitCode: number }>
  isAvailable(runtime: SupportedRuntime): Promise<boolean>
  initialize(runtime: SupportedRuntime): Promise<void>
}
