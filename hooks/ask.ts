// Whether a main-loop turn ended by asking the person something: read off the
// turn's last words and its wrap-up call, with no model call.

// The desktop app's wrap-up tool: its `ask` is a question put to the person.
export const WRAP_UP = /^mcp__ccd_turn__wrap_up$/u

/** What a turn asked of the person: a round of `count` questions, or one, with the ask itself. */
export type Ask = { count: number; detail?: string }

// A numbered question marker of a grilling round: ❓ or **Q<n>**.
const MARKER = /❓|\*\*Q\d+/gu

// Markup that may close a paragraph after its last word.
const TRAILING = /[\s*_`~)\]"'”’>]+$/u

// The ask, first match wins: the wrap-up's ask, a round of two or more
// numbered questions, then a last paragraph that ends with a question mark.
export const askOf = (answer: string, wrapUpAsk?: string): Ask | undefined => {
  const asked = wrapUpAsk?.trim() ?? ''
  if (asked !== '') return { count: 1, detail: asked }
  const markers = answer.match(MARKER)?.length ?? 0
  if (markers >= 2) return { count: markers }
  const paragraphs = answer.trim().split(/\n\s*\n/u)
  const last = (paragraphs.at(-1) ?? '').replace(TRAILING, '')

  return last.endsWith('?') ? { count: 1 } : undefined
}

// The ask's wording on the strip.
export const askText = (count: number | undefined): string =>
  count !== undefined && count >= 2 ? `${count} questions for you` : 'a question for you'
