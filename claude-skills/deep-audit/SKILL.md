---
name: deep-audit
description: Deep codebase audit — understand intent, ask hard questions, surface non-obvious improvements, then prioritize by impact
disable-model-invocation: true
argument-hint: "[path or project scope]"
---

Do not write any code or suggest changes yet. Your first job is to understand.

Target: $ARGUMENTS (defaults to current project root if empty)

## Phase 1: Deep Read

Read the entire codebase. For each file, build a mental model of:
- What it does
- Why it exists (the intent behind it, not just the function)
- How it connects to other files
- What assumptions it makes

**Output a brief file-by-file map:**

```
filename → what it does → its role in the system
```

This is your checkpoint. Present it before moving on so I can catch any misreads early.

Wait for my confirmation before continuing.

## Phase 2: Reconstruct My Intent

Based on everything you read, tell me:
1. What you think this project is trying to accomplish
2. Who it's for
3. What problem it solves
4. What my design philosophy seems to be (patterns, tradeoffs I chose)

Then ask me: "Is this accurate? What am I missing?"

Wait for my response before continuing.

## Phase 3: Ask Me Hard Questions

Ask 5-10 questions that expose:
- Ambiguities in the design (places where you can't tell what I intended)
- Contradictions (where two parts of the code imply different goals)
- Unstated assumptions (things the code assumes but doesn't enforce)
- Missing pieces (things the project clearly needs but doesn't have)

Wait for my answers before continuing.

## Phase 4: Think Beyond What I Asked For

Be willing to tell me if the core approach or architecture is misguided, not just if the implementation can be improved. I'd rather hear a hard truth here than polished suggestions on a wrong foundation.

Now — based on the code AND my answers — think deeply about:

### A. What's broken or fragile
- Bugs I probably don't know about
- Edge cases that will fail silently
- Architectural decisions that will cause pain at scale

### B. What's missing that I haven't thought of
- Features that would 10x the value but I haven't considered
- Patterns from other domains that apply here
- Data I'm not capturing that I'll wish I had later

### C. What's over-engineered or unnecessary
- Code that exists but adds no value
- Abstractions that make things harder, not easier
- Complexity that could be eliminated

### D. What would an expert in this domain change
- What would a senior quant researcher at a systematic fund, or a production ML engineer who's shipped a live alpha pipeline, say about this?
- What separates this from production-grade?

### E. Non-obvious improvements
- Things that aren't wrong but could be dramatically better
- Small changes with outsized impact
- Connections between parts of the codebase that I'm probably not seeing

## Phase 5: Prioritized Action Plan

Rank everything you found by: (impact × feasibility)

For each item:

| # | What | Why it matters | Effort | Impact |
|---|------|---------------|--------|--------|

Start with the single highest-leverage change — the one thing that would improve the most with the least effort.

Then ask me which items I want you to implement.
