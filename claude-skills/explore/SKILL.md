---
name: explore
description: Deep-dive into a codebase area - understand architecture, data flow, and how things connect
disable-model-invocation: true
argument-hint: "<topic or question>"
context: fork
agent: Explore
---

## Codebase Exploration

Question/Topic: $ARGUMENTS

### Approach:

1. **Identify entry points** related to the topic
   - Search for relevant file names, function names, class names
   - Check route definitions, exports, and config files

2. **Trace the flow**
   - Follow imports and function calls
   - Map out the data flow from input to output
   - Identify key abstractions and their relationships

3. **Document findings** as a clear summary:

```
## Architecture Overview
<how the pieces fit together>

## Key Files
- `path/file.ts:line` — what it does

## Data Flow
<step by step how data moves through the system>

## Dependencies
<what this area depends on, what depends on it>

## Notes
<gotchas, tech debt, or important context>
```

Keep the output focused and practical — what someone needs to know to work in this area.
