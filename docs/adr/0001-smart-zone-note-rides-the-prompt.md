# The smart-zone note to Claude rides the prompt, not the system prompt

When the session's context crosses the smart-zone caution or the smart-zone limit, Polis tells Claude so, once per crossing, as text added after the person's next prompt (`prompt.submit`'s `context`), not as a section of the system prompt the way the `guidance` text is. A system prompt that changes mid-session throws away the prompt cache, and at these moments the cache holds 120k tokens or more, so the note itself would make Claude read the whole session again at full price.

## Consequences

- A crossing in the middle of a long turn reaches Claude only at the person's next prompt. The person's own warning (band, toast, status line, city page) shows at once, and they can interrupt.
- Rewriting tool results to reach Claude mid-turn was considered and rejected as fragile.
