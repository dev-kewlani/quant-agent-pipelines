---
name: review
description: Code review - analyze recent changes or a specific file for bugs, quality, and improvements
disable-model-invocation: true
argument-hint: "[file-or-path]"
context: fork
agent: Explore
---

## Code Review

Target: $ARGUMENTS

If no target specified, review the most recent uncommitted changes (`git diff` + `git diff --staged`).

### Review Checklist:

**Correctness**
- Logic errors, off-by-one, null/undefined risks
- Race conditions or async issues
- Missing error handling at system boundaries

**Security**
- Injection risks (SQL, XSS, command)
- Hard-coded secrets or credentials
- Improper input validation

**Performance**
- Unnecessary re-renders, recomputations
- N+1 queries, missing indexes
- Large allocations in hot paths

**Maintainability**
- Dead code, unused variables/imports
- Overly complex logic that could be simplified
- Missing types or unclear interfaces

### Output Format:

For each finding:
```
[SEVERITY] file:line — description
  → suggestion
```

Severities: `🔴 CRITICAL` | `🟡 WARNING` | `🔵 SUGGESTION`

End with a brief summary: total findings by severity, overall assessment.
