---
name: prompt-review
description: Review a prompt for quality, precision, and fitness for purpose — structural analysis, missing sections, failure modes, cut recommendations
disable-model-invocation: true
argument-hint: "[paste prompt or path to prompt file]"
---

You are a prompt engineer reviewing a prompt for quality, precision, and fitness for purpose. Your job is to produce a review. Do not rewrite the prompt — that happens separately after I decide which findings to accept.

---

## Context — fill these in before the review

### What this prompt is trying to do
$ARGUMENTS

[If not provided above: describe the task the prompt is designed to accomplish. Not "review code" but "get an agent to audit a quantitative analytics tool and surface gaps a senior enterprise buyer would reject it for."]

### Who or what will execute this prompt
[Be specific about capabilities: model (Claude/GPT-4/etc), tool access (file read, web search, code execution, none), context window size, whether the agent can ask follow-up questions or must produce a single-shot response.]

### What a good output looks like
[Describe the ideal response concretely: "A prioritized table of findings with severity ratings and effort estimates" not "useful feedback."]

### What failure modes I already know about
[List the ones you've seen. The reviewer must check for these AND identify failure modes you haven't listed. Your job as reviewer is to find failures I missed, not just confirm mine.]

### The prompt to review
[Paste the full prompt here, or provide a file path to read]

---

Scale your review depth to the prompt's complexity. For prompts under 50 lines, focus on what's missing. For prompts over 200 lines, focus on what should be cut and what contradicts.

Now do the following in order:

---

## Phase 1: Fitness for Purpose

For each phase or section of the prompt:
- What output will this section actually produce from the target agent?
- Does that output serve the stated goal?
- Where will the agent take the path of least resistance and produce something shallow?

For every section where you flag laziness risk: **state the lazy output AND the rigorous output**, so I can see the gap and add constraints to close it.

---

## Phase 2: What's Structurally Wrong

For each structural issue you find, explain **WHY it's a problem for this specific prompt's goal** — not just that it exists. A missing output format matters differently for a code review prompt vs. an analytics audit prompt.

Check for:
- Instructions that are unanswerable as written (asks the agent to observe what it can only infer from code/text)
- Missing output formats (sections that will produce unstructured prose when a table would be more actionable)
- Waits/checkpoints that don't specify what to do with the user's response (incorporate? revise? just acknowledge?)
- Persona or role instructions that aren't reinforced past the first section — agents drift by Phase 3
- Scope instructions missing (what does the agent do with 80 files / 40 dashboards / a huge codebase?)
- Ranking or prioritization formulas where effort is multiplied instead of divided
- Phase continuity gaps (can the agent contradict itself between sections with no consequence?)
- Permission gaps (is the agent allowed to challenge the fundamental approach, or only suggest improvements within the existing frame?)

---

## Phase 3: What's Missing

Work backward from the stated goal: what are the 5-7 things that MUST be true about the output for the goal to be met? For each, trace whether the prompt guarantees it. Anything unguaranteed is a gap.

Then check:
- Sections entirely absent that the stated goal requires
- Failure modes the prompt doesn't protect against (beyond the ones the author listed)
- Questions the agent should ask the user but isn't told to
- Constraints missing that would prevent the agent from drifting into generic territory
- Output validation (does the prompt tell the agent how to verify its own work?)

---

## Phase 4: What Should Be Cut

Identify at least 2 things to cut. If you genuinely cannot find 2, explain why every section is load-bearing for the stated goal.

Check for:
- Instructions written for a human reader, not the executing agent (meta-commentary, "why this is different from X" sections, explanatory notes)
- Redundant sections that will produce overlapping output
- Questions the agent cannot answer from the available inputs
- Sections that sound important but won't change the agent's behavior (decorative instructions)

---

## Summary

Output a single table:

| # | Finding | Phase | Severity (breaks output / weakens output / cosmetic) | Specific Fix |
|---|---------|-------|------------------------------------------------------|-------------|

Then: "Which of these findings do you want me to apply? I'll rewrite only after you confirm."
