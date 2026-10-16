# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues on `SashimmyUni/polis`. Use the `gh` CLI (2.94 or later) for all operations; it infers the repo inside a clone, so `--repo` is only needed elsewhere.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body-file <file>`. Write multi-line bodies to a file in the scratchpad first.
- **Read an issue**: `gh issue view <number> --json number,title,body,labels,comments`.
- **List issues**: `gh issue list --state open --json number,title,labels` with `--label` and `--state` filters.
- **Make an issue a sub-issue**: `gh issue create --parent <parent> ...`, or `gh issue edit <parent> --add-sub-issue <child>` afterwards.
- **Comment**: `gh issue comment <number> --body-file <file>`.
- **Labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`.
- **Close**: `gh issue close <number> --comment "..."`.

The GitHub login is `SashimmyUni`. The git author name (`Sashimmy`) is not a GitHub user, so assign with `@me`.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Read it as in **Read an issue** above.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **sub-issues** as tickets. Labels already exist: `wayfinder:map`, `wayfinder:research`, `wayfinder:prototype`, `wayfinder:grilling`, `wayfinder:task`.

- **Find the maps**: `gh issue list --label wayfinder:map --state open --json number,title`.
- **Map**: `gh issue create --label wayfinder:map --title "Map: ..." --body-file <file>`. Edit its body with `gh issue view <map> --json body -q .body > <file>`, change the file, then `gh issue edit <map> --body-file <file>`. Check the change landed before writing it back.
- **Child ticket**: `gh issue create --parent <map> --label wayfinder:<type> --title "..." --body-file <file>`.
- **Blocking**: GitHub's native issue dependencies. Add an edge with `gh api --method POST repos/SashimmyUni/polis/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`, where the database id comes from `gh api repos/SashimmyUni/polis/issues/<blocker> --jq .id` (not the `#number` or `node_id`). List a ticket's blockers with `gh api repos/SashimmyUni/polis/issues/<n>/dependencies/blocked_by --jq '.[]|"\(.number) \(.state)"'`.
- **Frontier query**: open, unassigned children with no open blocker, in map order:

  ```bash
  gh api repos/SashimmyUni/polis/issues/<map>/sub_issues --jq '.[] | select(.state=="open" and (.assignees|length)==0 and .issue_dependencies_summary.blocked_by==0) | "\(.number)\t\([.labels[].name]|join(","))\t\(.title)"'
  ```

- **Claim**: `gh issue edit <n> --add-assignee @me`, the session's first write.
- **Resolve**: `gh issue comment <n> --body-file <answer>`, then `gh issue close <n>`, then append a context pointer (gist + link) to the map's Decisions so far.
