---
'@astroscope/i18n': patch
---

the inline i18n script no longer emits JavaScript reserved words (`do`, `if`, `in`, …) as generated chunk variable names — hitting one was a SyntaxError that silently disabled every client-side translation on the page
