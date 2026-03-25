---
name: branch-cleanup
description: List and optionally delete merged or stale local branches
disable-model-invocation: true
---

## Branch Cleanup

1. Fetch latest remote state: `git fetch --prune`
2. List all local branches and their merge status relative to the default branch
3. Categorize branches:
   - **Merged**: already merged into main/master (safe to delete)
   - **Gone**: remote tracking branch deleted (likely merged via PR)
   - **Active**: has unmerged commits
4. Show the categorized list to the user
5. Ask which categories to clean up before deleting anything
6. Delete confirmed branches with `git branch -d` (safe delete only, never force)
7. Show final branch list
