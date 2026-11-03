---
'@astroscope/relay': patch
---

conversion user hashing: phone numbers drop a `(0)` trunk prefix after the country code, accept `/` and `.` as separators and are dropped without a country calling code; postal codes lose their dashes, US zip codes keep their first five digits
