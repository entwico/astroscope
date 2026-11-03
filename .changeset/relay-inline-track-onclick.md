---
'@astroscope/relay': major
---

`data-track`, `trackAttribute()` and `RELAY_TRACK_ATTRIBUTE` are gone: a link or button tracks on click with `onclick={inlineTrack(event)}`, which also works before the bus has loaded through a queue the integration puts into every page head
