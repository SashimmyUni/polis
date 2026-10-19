// Notifications: what this session raises when its AFK work needs a look the
// person is not there to give. Waits (permissions, questions, a turn waiting)
// are Claude Code's own to notify; Polis never raises them.
import type { EngineInterface } from 'claude-code'
import { clip, compact, projectName } from './logic'

export const NOTIFY_TITLE = 'Polis'

// The session as a notification names it: its first prompt, else its project.
export const sessionName = (title: string, root: string): string =>
  title !== '' ? `"${clip(title, 40)}"` : `A session in ${projectName(root)}`

export const stallText = (name: string, why: string): string => `${name} stalled: ${why}`

export const zoneText = (name: string, tokens: number, limit: number): string =>
  `${name} is out of the smart zone: context ${compact(tokens)} is past ${compact(limit)}`

// Raises `text` as a native notification; where none is sent, or the
// notification is refused, a toast stands in.
// A function declaration: the engine follows $ past an import only into one.
export async function raise($: EngineInterface, text: string): Promise<void> {
  const isSent = await $.ui.notify(text, { title: NOTIFY_TITLE }).then(
    sent => sent.isSent,
    () => false,
  )
  if (!isSent) $.ui.toast(text)
}
