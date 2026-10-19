// The glossary check: no user-facing string in hooks/ uses a word GLOSSARY.md
// lists under _Avoid_. It reads every _Avoid_ line, keeps the terms that stand
// alone (a parenthesised note narrows a term to one meaning, which a search
// cannot tell apart, so those are left to review), and looks for each as a
// whole word inside the string literals of hooks/. Words already in use on
// purpose are listed in KEPT with the file they sit in.
//   node tools/glossary.ts
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// Deliberate uses, and uses that predate the check (renaming those is UI
// work of its own): `file: term`. A new use needs the glossary term instead.
const KEPT = new Set([
  // sessionState's legacy state, and the live record mapping it to idle.
  'logic.ts: your turn',
  'city.ts: your turn',
  'page.ts: your turn',
  'views.tsx: your turn',
  'live.ts: your turn',
  // Predate the check.
  'logic.ts: this session',
  'register.tsx: this session',
  'register.tsx: waiting',
  'register.tsx: page on disk',
  'register.tsx: whole project',
  'report.ts: waiting',
  'verify.ts: not checked',
  'views.tsx: this session',
  'views.tsx: waiting',
  'views.tsx: not checked',
])

const avoided = (glossary: string): string[] =>
  glossary
    .split('\n')
    .filter((line) => line.startsWith('_Avoid_:'))
    .flatMap((line) => line.slice('_Avoid_:'.length).split(','))
    .map((term) => term.trim())
    .filter((term) => term !== '' && !term.includes('('))
    // One generic word is too common to search for; only phrases and
    // distinctive single words are checked.
    .filter((term) => term.includes(' ') || DISTINCT.has(term))

// Single words distinctive enough to search for on their own.
// ('pending' is left out: it is a task status value in Claude's own tools.)
const DISTINCT = new Set(['waiting', 'stuck', 'hung', 'frozen', 'autonomous', 'interactive', 'hands-on', 'hands-off'])

// The text of every quoted or template string in a source file, comments and
// a template's ${…} expressions left out.
const strings = (source: string): string[] => {
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .map((line) => line.replace(/\s\/\/ .*$/, ''))
    .join('\n')
  return [...code.matchAll(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g)].map((m) =>
    m[0].slice(1, -1).replace(/\$\{[^}]*\}/g, ' '),
  )
}

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const terms = [...new Set(avoided(readFileSync(join(root, 'GLOSSARY.md'), 'utf8')))]
const hooks = join(root, 'hooks')
const found: string[] = []
for (const file of readdirSync(hooks).filter((name) => /\.tsx?$/.test(name))) {
  const texts = strings(readFileSync(join(hooks, file), 'utf8'))
  for (const term of terms) {
    if (KEPT.has(`${file}: ${term}`)) continue
    const word = new RegExp(`\\b${escape(term)}\\b`, 'i')
    const hit = texts.find((text) => word.test(text))
    if (hit !== undefined) found.push(`hooks/${file}: "${term}" in ${JSON.stringify(hit.slice(0, 80))}`)
  }
}

if (found.length > 0) {
  console.error('words GLOSSARY.md lists under _Avoid_ appear in user-facing strings:')
  for (const line of found) console.error(`  ${line}`)
  console.error('Use the glossary term instead, or add a deliberate use to KEPT in tools/glossary.ts.')
  process.exit(1)
}
