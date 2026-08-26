---
'@astroscope/node': major
---

image processing is now off unless configured: when the astro config leaves `image.service` at its default, any `astro:assets` use (`<Image>`, `getImage()`, markdown images) throws with an explanation and `/_image` answers 404 — in SSR the on-demand sharp endpoint is an abuse-prone amplification surface most apps don't need. Control via the new `imageService: 'on' | 'off' | 'auto'` adapter option: `'on'` keeps astro's sharp service, `'off'` forces off, `'auto'` (default) follows whether `image.service` is set
