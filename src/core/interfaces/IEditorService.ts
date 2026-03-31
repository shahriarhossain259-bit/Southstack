// ============================================================
// CORE SERVICES LAYER: EditorService interface
// Manages tab lifecycle, dirty tracking, and editor sync
// ============================================================

export interface EditorTab {
  id: string
  path: string
  label: string
  content: string
  draftContent?: string
  isDirty: boolean
  language: string
  cursorLine?: number
  cursorCol?: number
}

export interface IEditorService {
  // Tab management
  openTab(path: string, content: string): Promise<EditorTab>
  closeTab(tabId: string): void
  switchTab(tabId: string): void
  getActiveTab(): EditorTab | null
  getAllTabs(): EditorTab[]

  // Content management
  updateContent(tabId: string, content: string): void
  updateContentFromExternal(path: string, content: string): void
  saveTab(tabId: string): Promise<void>
  saveAllTabs(): Promise<void>
  markClean(tabId: string): void

  // Draft Management (Antigravity-style)
  proposeChange(path: string, content: string): Promise<void>
  acceptDraft(tabId: string): Promise<void>
  rejectDraft(tabId: string): void

  // State queries
  isDirty(tabId: string): boolean
  findTabByPath(path: string): EditorTab | undefined

  // Subscriptions
  onTabsChange(cb: (tabs: EditorTab[]) => void): () => void
  onActiveTabChange(cb: (tab: EditorTab | null) => void): () => void
}
