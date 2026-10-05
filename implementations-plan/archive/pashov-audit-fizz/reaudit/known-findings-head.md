# Known findings — ground already walked

Earlier scans of this repository recorded the findings below, grouped by the contract and
function they sit in. Each line is `bug class` — kind, scans, title.

**They are not false positives, and they are not off limits.** Put your **effort** into new
ground: functions, flows and mechanisms this list does not name. That is a rule about where
your reading time goes. It is **not** a rule about what you report.

**Report every bug you find in full, listed or not.** A listed bug you reach again is a bug
that is still there, and the report has to say so. Write it up exactly as you would write up
anything new — the same path, proof and fix — whether you reached it by the mechanism it is
listed with or by a different one. Silence is read as "nobody found this": a finding no agent
raises drops out of the report into a table of records nobody re-checked, so a repository
scanned twice would show fewer bugs than the same repository scanned once.

**Reuse the bug-class label.** The backticked label on each line is the word this repository
already uses for that class of bug in that function. When you report a finding or a lead
whose bug class is one of the classes listed for that same contract and function, write
**that exact label**. Invent a new label only when none of them is the same class of bug.
Memory matches these labels as plain text, so the same bug under a new word is remembered
twice and recognised never.

