---
'@astroscope/i18n': major
---

the integration now injects the `/_i18n/` chunk middleware itself; `createI18nChunkMiddleware` is removed — delete its call from `src/middleware.ts`
