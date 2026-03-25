---
name: audit-me
description: Consolidate all memories, chat logs, and project context to surface automatable patterns, repeated tasks, and skill gaps
disable-model-invocation: true
---

## Self-Audit & Automation Discovery

You are performing a full audit of the user's work patterns, stored knowledge, and habits across all available data. The goal is to surface **what can be automated, templated, or turned into a skill**.

### Step 1: Gather Everything

Read ALL of the following sources. Do not skip any.

**Memory files** — read every `.md` file in every project memory directory:
```
~/.claude/projects/*/memory/*.md
```

**Chat logs** — scan for patterns in saved conversation logs:
```
~/.claude/chat_logs/*.md
```

**Global instructions** — understand the user's setup and preferences:
```
~/.claude/CLAUDE.md
```

**Existing skills** — catalog what's already automated:
```
~/.claude/skills/*/SKILL.md
```

**Project CLAUDE.md files** — check for per-project instructions:
```
Find any .claude/CLAUDE.md or CLAUDE.md in recent project directories
```

### Step 2: Analyze & Categorize

From everything you read, extract and organize into these categories:

#### A. Repeated Tasks
Things the user does over and over. Look for:
- Similar prompts across chat logs
- Patterns in git history themes
- Recurring topics in memories
- Workflows mentioned in CLAUDE.md files

Format:
```
| Task | Frequency Signal | Currently Automated? | Skill Opportunity |
|------|-----------------|---------------------|-------------------|
```

#### B. Knowledge & Expertise Map
What domains and skills the user works in. Look for:
- Project types and technologies
- Topics they ask about vs. topics they teach/explain
- Depth indicators (beginner questions vs. advanced patterns)

Format:
```
## Expertise Areas
- **[Domain]**: [Level: deep/working/learning] — evidence: [what you found]
```

#### C. Tool & Stack Profile
Languages, frameworks, services, and tools the user works with.

Format:
```
## Tech Stack
- **Languages**: ...
- **Frameworks**: ...
- **Services/APIs**: ...
- **Dev tools**: ...
```

#### D. Workflow Patterns
How the user likes to work — preferences, styles, habits.

Format:
```
## Work Patterns
- Prefers X over Y
- Tends to [pattern]
- Avoids [pattern]
```

#### E. Gaps & Opportunities
Things that SHOULD be skills but aren't yet. Look for:
- Tasks done manually that could be automated
- Multi-step workflows that repeat
- Common prompts that could be templated
- Knowledge lookups that could be pre-loaded

Format:
```
## Recommended New Skills
1. **`/skill-name`** — what it would do
   - Trigger: when/why the user would use it
   - Saves: what time/effort it saves
   - Based on: [evidence from logs/memories]
```

### Step 3: Output

Present the full consolidated report with all sections above. End with:

1. **Top 5 highest-impact automations** ranked by frequency x effort saved
2. **Quick wins** — skills that would take <5 minutes to create
3. **Ask the user**: "Which of these should I build right now?"

### Important
- Be specific, not generic. Ground every recommendation in actual evidence from the files you read.
- If a source doesn't exist (e.g., no chat logs yet), note it and move on.
- Don't invent patterns that aren't there — only report what the data supports.
