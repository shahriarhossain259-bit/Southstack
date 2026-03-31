import { FolderOpen, Trash2, X } from 'lucide-react'

interface RestorePromptProps {
  onRestore: () => void
  onClear: () => void
  onClose: () => void
}

export function RestorePrompt({ onRestore, onClear, onClose }: RestorePromptProps) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-surface-200 border border-border rounded-xl shadow-2xl max-w-md w-full overflow-hidden transform animate-scale-in">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-surface-300">
          <div className="flex items-center gap-2">
            <FolderOpen size={18} className="text-primary-300" />
            <h3 className="text-sm font-semibold text-text-primary uppercase tracking-wider">Restore Project?</h3>
          </div>
          <button 
            onClick={onClose}
            className="text-text-dim hover:text-text-primary transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-8">
          <p className="text-xs text-text-secondary leading-relaxed">
            We found a previous project session in your browser. Would you like to restore your files and terminal state?
          </p>
          <div className="mt-4 p-3 rounded-lg bg-warning/5 border border-warning/20">
            <p className="text-[10px] text-warning leading-normal">
              <strong>Note:</strong> Browsers require a manual permission click to re-access your local folder.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex flex-col gap-2 p-5 bg-surface-300 border-t border-border">
          <button
            onClick={onRestore}
            className="w-full py-2 bg-primary-500 hover:bg-primary-400 text-white text-xs font-semibold rounded-lg transition-all shadow-lg shadow-primary-500/20 active:scale-95"
          >
            Restore Previous Project
          </button>
          <button
            onClick={onClear}
            className="w-full py-2 flex items-center justify-center gap-2 text-error hover:bg-error/10 text-xs font-medium rounded-lg transition-colors border border-transparent hover:border-error/20"
          >
            <Trash2 size={13} />
            Discard & Clear Cache
          </button>
        </div>
      </div>
    </div>
  )
}
