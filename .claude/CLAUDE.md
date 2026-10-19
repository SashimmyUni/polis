## Agent skills

### Issue tracker

GitHub issues on `SashimmyUni/polis`, through `gh`. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: `GLOSSARY.md` and `docs/adr/` at the root. See `docs/agents/domain.md`.

## Architecture

Which module holds what, where new state is wired in, and how to check an engine fact in a real host: `docs/agents/architecture.md`.

## Manual

Each surface's user-facing behaviour: `docs/MANUAL.md`.

## Check command

Before committing, run `node tools/check.ts`: it validates, type-checks and tests the mod, and must exit 0.
