---
name: commit
description: Create a well-structured conventional commit from staged or unstaged changes
disable-model-invocation: true
argument-hint: "[optional message hint]"
---

## Create a Conventional Commit

1. Run `git status` and `git diff` (staged + unstaged) to understand all changes
2. If nothing is staged, identify the relevant changed files and stage them (prefer specific files over `git add .`)
3. Classify the change type:
   - `feat` — new feature
   - `fix` — bug fix
   - `refactor` — restructuring without behavior change
   - `docs` — documentation only
   - `test` — adding/updating tests
   - `chore` — tooling, deps, config
   - `perf` — performance improvement
   - `style` — formatting, whitespace
4. Determine a scope from the area of code changed (e.g., `auth`, `api`, `ui`, `db`)
5. Write commit message in format: `<type>(<scope>): <short imperative summary>`
   - Subject line under 72 chars
   - If the change is non-trivial, add a body explaining **why**, not what
6. If `$ARGUMENTS` is provided, use it as a hint for the commit message content
7. Create the commit
8. Show the final commit log entry

Do NOT amend previous commits. Always create a new commit.
