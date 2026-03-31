// ============================================================
// CORE UTILS: Language detection from file path
// ============================================================

const EXT_MAP: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  php: 'php',
  go: 'go',
  rs: 'rust',
  c: 'c',
  cpp: 'cpp',
  h: 'c',
  java: 'java',
  rb: 'ruby',
  cs: 'csharp',
  kt: 'kotlin',
  swift: 'swift',
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'scss',
  less: 'less',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  md: 'markdown',
  mdx: 'markdown',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  sql: 'sql',
  xml: 'xml',
  toml: 'ini',
  env: 'ini',
  ini: 'ini',
  dockerfile: 'dockerfile',
  txt: 'plaintext',
}

export function getLanguageFromPath(path: string): string {
  const fileName = path.split('/').pop() ?? ''
  if (fileName.toLowerCase() === 'dockerfile') return 'dockerfile'
  const ext = fileName.split('.').pop()?.toLowerCase() ?? ''
  return EXT_MAP[ext] ?? 'plaintext'
}

export function getFileIcon(path: string): string {
  const lang = getLanguageFromPath(path)
  const iconMap: Record<string, string> = {
    typescript: '🔷',
    javascript: '🟡',
    python: '🐍',
    php: '🐘',
    go: '🐹',
    rust: '🦀',
    html: '🌐',
    css: '🎨',
    json: '📋',
    markdown: '📝',
    shell: '⚡',
    plaintext: '📄',
  }
  return iconMap[lang] ?? '📄'
}
