---
name: pr
description: Create a GitHub pull request with a structured summary from the current branch
disable-model-invocation: true
argument-hint: "[optional base branch]"
---

## Create a Pull Request

1. Determine the base branch:
   - If `$ARGUMENTS` is provided, use it as the base branch
   - Otherwise default to `main` (fall back to `master` if `main` doesn't exist)

2. Gather context:
   - Run `git log <base>..HEAD --oneline` to see all commits being merged
   - Run `git diff <base>...HEAD --stat` to see files changed
   - Run `git diff <base>...HEAD` to understand the full diff

3. Push the current branch to remote if not already pushed:
   ```
   git push -u origin HEAD
   ```

4. Draft the PR:
   - **Title**: Short (<70 chars), imperative. E.g., "Add user authentication middleware"
   - **Body**: Use this template:

```
## Summary
<2-4 bullet points covering what changed and why>

## Changes
<grouped list of notable changes by area>

## Test plan
- [ ] <concrete testing steps>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

5. Create with: `gh pr create --title "..." --body "$(cat <<'EOF' ... EOF)"`
6. Return the PR URL
