---
'@astroscope/node': patch
---

head emissions are inserted before the real `</head>` (never before head-like text inside a script or comment, `<header>` is not the head) and the islands rewriter never injects inside `<script>`/`<style>` within inline svg or mathml
