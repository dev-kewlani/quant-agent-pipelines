---
name: gen-test
description: Generate tests for a file or function, matching the project's testing patterns
disable-model-invocation: true
argument-hint: "<file-or-function>"
---

## Generate Tests

Target: `$ARGUMENTS`

### Steps:

1. **Read the target** code thoroughly to understand its behavior, edge cases, and dependencies

2. **Detect test setup**: Find existing tests to understand:
   - Test framework (jest, vitest, pytest, go test, etc.)
   - Test file location convention (co-located, `__tests__/`, `tests/`, `*_test.go`)
   - Test naming patterns
   - Assertion style
   - Mock/stub patterns used
   - Setup/teardown patterns

3. **Identify test cases**:
   - Happy path for each public function/method
   - Edge cases (empty input, null, boundary values)
   - Error cases (invalid input, thrown exceptions)
   - If it's a component: render, interaction, and state tests

4. **Write tests** matching the project's existing style exactly

5. **Run the tests** to verify they pass. Fix any failures.

6. Show a summary of what was tested and coverage areas
