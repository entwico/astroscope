---
'@astroscope/eslint-plugin': major
---

`no-raw-strings-in-jsx`: `ignorePatterns` adds to the built-in patterns (exported as `DEFAULT_IGNORE_PATTERNS`) instead of replacing them, an entry that is not a valid regular expression fails the lint run with a message naming it, and text that merely starts with a brace is no longer skipped
