# Task Progress

## Status: idle
## Last Task: Removed the stray bullet marker next to "Settings" in the sidebar nav.
## Root cause: NavItem's <li> root rendered outside any <ul>/<ol>, so it kept the
## browser's default disc marker instead of picking up Tailwind's list-style reset
## (preflight resets ul/ol only). Fixed by wrapping in <ul>, documented NavItem's
## list-parent contract, added a regression test (Sidebar.test.tsx). Reviewed
## PASS (quality: PASS_WITH_NOTES, adversarial: RESILIENT); a11y nav-label gap
## logged as deferred tech debt in vision.md.
## Last Completed: 2026-09-06
## Steps Completed: all
