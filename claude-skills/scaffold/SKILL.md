---
name: scaffold
description: Generate boilerplate code for a new component, module, API endpoint, or feature
disable-model-invocation: true
argument-hint: "<type> <name> [options]"
---

## Scaffold New Code

Arguments: `$ARGUMENTS`
- `$0` = type (e.g., component, api, model, service, hook, page, module)
- `$1` = name (e.g., UserProfile, auth, payments)
- Remaining args = options/flags

### Steps:

1. **Detect project context**: Read package.json, tsconfig, pyproject.toml, go.mod, or similar to understand:
   - Language and framework in use
   - Project structure and conventions
   - Existing patterns to follow

2. **Find existing examples**: Look for existing files of the same type to match:
   - File naming convention (PascalCase, kebab-case, snake_case)
   - Directory structure
   - Import patterns
   - Export patterns
   - Code style

3. **Generate files** following the detected conventions. Common patterns:
   - **React component**: component file + types + index export + test file
   - **API endpoint**: route handler + validation + types
   - **Service/module**: implementation + interface/types + test
   - **Model**: schema/model definition + types + migration if applicable

4. **Do NOT add** unnecessary comments, excessive error handling, or features not requested

5. Show the user what was created with a brief summary
