---
'@astroscope/node': minor
---

a render that fails after the response started is logged with its route, the completion line reads `request truncated`, the server span carries `astro.response.truncated` and `astro.render.failures` counts it
