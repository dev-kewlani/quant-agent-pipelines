---
name: security-scan
description: Scan code for security vulnerabilities, secrets, and OWASP top 10 issues
disable-model-invocation: true
argument-hint: "[path or scope]"
context: fork
agent: Explore
allowed-tools: Read, Grep, Glob
---

## Security Scan

Target: $ARGUMENTS (defaults to entire project if empty)

### Scan for:

1. **Secrets & Credentials**
   - API keys, tokens, passwords in source
   - .env files committed to git
   - Hard-coded connection strings

2. **Injection Vulnerabilities**
   - SQL injection (string concatenation in queries)
   - Command injection (unsanitized shell exec)
   - XSS (unescaped user input in HTML/templates)
   - Path traversal (user input in file paths)

3. **Authentication & Authorization**
   - Missing auth checks on endpoints
   - Weak session management
   - Improper JWT validation

4. **Data Exposure**
   - Sensitive data in logs
   - Verbose error messages leaking internals
   - CORS misconfigurations

5. **Dependencies**
   - Check for known vulnerable packages if lockfile exists

### Output:

```
[CRITICAL|HIGH|MEDIUM|LOW] file:line
  Issue: <description>
  Risk: <what could go wrong>
  Fix: <how to fix it>
```

End with a summary table of findings by severity.
