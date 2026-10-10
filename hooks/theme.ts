import type { ToolFamily } from '../types'

// One soft dark palette, shared by the text views and the city.
export const C = {
  bg: '#14161c',
  ground: '#1c2029',
  tile: '#232834',
  tileEdge: '#2b3140',
  road: '#2b3140',
  roadMark: '#3a4254',
  text: '#c9cfdb',
  muted: '#7b8496',
  faint: '#4a5263',
  done: '#8fbf9f',
  run: '#e0c38c',
  agent: '#8ea6e0',
  fail: '#d98c9a',
  skill: '#b39ddb',
  proc: '#7fc8c2',
} as const

export const FAMILIES: readonly ToolFamily[] = [
  'search',
  'read',
  'edit',
  'shell',
  'web',
  'mcp',
  'skill',
  'delegate',
  'plan',
  'other',
]

export const FAMILY_LABEL: Record<ToolFamily, string> = {
  search: 'search',
  read: 'read',
  edit: 'edit',
  shell: 'shell',
  web: 'web',
  mcp: 'connectors',
  skill: 'skills',
  delegate: 'delegate',
  plan: 'plan',
  other: 'other',
}

// What a tool badge reads as where no icon can be drawn.
export const FAMILY_GLYPH: Record<ToolFamily, string> = {
  search: '⌕',
  read: '▤',
  edit: '✎',
  shell: '❯',
  web: '◍',
  mcp: '⧉',
  skill: '✦',
  delegate: '⇄',
  plan: '☰',
  other: '·',
}

export const FAMILY_COLOR: Record<ToolFamily, string> = {
  search: C.proc,
  read: C.agent,
  edit: C.run,
  shell: C.done,
  web: C.proc,
  mcp: C.skill,
  skill: C.skill,
  delegate: C.agent,
  plan: C.muted,
  other: C.muted,
}

const FAMILY_OF: { [tool: string]: ToolFamily } = {
  Read: 'read',
  Grep: 'search',
  Glob: 'search',
  ToolSearch: 'search',
  Edit: 'edit',
  Write: 'edit',
  NotebookEdit: 'edit',
  Bash: 'shell',
  PowerShell: 'shell',
  Monitor: 'shell',
  TaskStop: 'shell',
  WebFetch: 'web',
  WebSearch: 'web',
  Skill: 'skill',
  Agent: 'delegate',
  Workflow: 'delegate',
  SendMessage: 'delegate',
  TodoWrite: 'plan',
  TaskCreate: 'plan',
  TaskUpdate: 'plan',
  TaskList: 'plan',
  TaskGet: 'plan',
  EnterPlanMode: 'plan',
  ExitPlanMode: 'plan',
  AskUserQuestion: 'plan',
}

export const familyOf = (tool: string): ToolFamily =>
  tool.startsWith('mcp__') ? 'mcp' : (FAMILY_OF[tool] ?? 'other')

export type AgentLook = { color: string; glyph: string; icon: string }

const LOOKS: { [type: string]: AgentLook } = {
  main: { color: C.agent, glyph: '◆', icon: 'a-main' },
  Explore: { color: C.proc, glyph: '◎', icon: 'a-explore' },
  Plan: { color: C.skill, glyph: '▧', icon: 'a-plan' },
  worker: { color: C.run, glyph: '⚒', icon: 'a-worker' },
  verifier: { color: C.done, glyph: '✓', icon: 'a-verifier' },
  'general-purpose': { color: C.agent, glyph: '●', icon: 'a-general' },
  claude: { color: C.agent, glyph: '●', icon: 'a-general' },
}

const SPARE = [C.agent, C.proc, C.skill, C.run, C.done]

// A plugin's agent type is `<plugin>:<name>`: its look goes by the name.
export const lookOf = (type: string): AgentLook => {
  const short = type.includes(':') ? type.slice(type.lastIndexOf(':') + 1) : type
  const known = LOOKS[short]
  if (known !== undefined) return known
  let hash = 0
  for (const char of short) hash = (hash * 31 + char.charCodeAt(0)) % 9973

  return { color: SPARE[hash % SPARE.length] ?? C.agent, glyph: '●', icon: 'a-general' }
}

export const VIEWS = [
  { name: 'overview', label: 'Overview' },
  { name: 'city', label: 'City' },
  { name: 'tasks', label: 'Tasks' },
  { name: 'agents', label: 'Agents' },
  { name: 'resources', label: 'Resources' },
  { name: 'skills', label: 'Skills' },
] as const
