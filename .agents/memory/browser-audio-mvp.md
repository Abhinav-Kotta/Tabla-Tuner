---
name: Browser audio MVPs
description: Guardrails for turning live browser microphone input into trustworthy user-facing measurements.
---

For musician-facing browser audio tools, an analyser frame is only a candidate measurement: gate it with an adaptive onset detector, reject low-confidence estimates, and require multiple mutually consistent readings before updating the UI.

**Why:** Attack transients, room noise, and strong harmonics can otherwise make an app look precise while reporting unstable or octave-shifted values.

**How to apply:** Keep DSP separate from React state, throttle visual updates, and make rejected readings visible without letting them advance progress.