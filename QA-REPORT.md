# QA report

## Summary

| Area | Checks | Result |
|---|---|---|
| Matching rules, crawler safeguards, check logic | 60+ assertions (`crawler/test.js`) | All pass |
| Tailoring function | 16 assertions (`api/tailor.test.js`) | All pass |
| Dashboard in a real browser | 70 automated checks | All pass |

The browser checks ran in Chromium at 1440, 640, 390, and 320 pixels wide, in light and dark mode.

## Accessibility (built to WCAG 2.1 AA)

- Colour contrast: every text colour on every background is at least 5.6:1 in light mode and 7.7:1 in dark mode. Field borders are at least 4:1.
- Every button, link, and form field has a name. Every field has a label. Headings run in order. No duplicate ids.
- Keyboard only: skip link is the first stop, every action is reachable, focus is always visible, and focus is kept or moved sensibly after each action instead of dropping to the top of the page.
- Pop-ups trap focus, close with Escape, and return focus to the button that opened them.
- Screen reader support: changes such as "Starred", "Hidden", status changes, and filter results are announced. Errors in the tailoring pop-up are announced as alerts. Each job is a labelled region with a heading.
- Touch targets are at least 24 pixels everywhere and 44 pixels for buttons and menus on phones.
- No sideways scrolling at 320 pixels or at 200% zoom on a laptop.
- Colour is never the only signal. New, closed, deadline, and caution states all have text.
- Reduced motion and Windows high contrast settings are respected.

## Problems found and fixed during review

1. Pop-ups pointed at headings that did not exist while closed. Now labelled directly.
2. Checkboxes were 20 pixels. Now 24.
3. On phones, several controls were under 44 pixels tall. Fixed.
4. The filter row forced sideways scrolling at 320 pixels. Fixed.
5. Loading a backup reset the "add to home screen" prompt so it showed again. Now device settings are kept.
6. Pressing star, hide, or changing a status dropped keyboard focus. Focus is now kept or moved to the next job.
7. The star button's name changed with its state while also reporting pressed, which reads as a double negative. Now one stable name.
8. The backup file included the access code. Removed.
9. A redirect from a careers page could have pointed the crawler at an internal address. Every hop is now checked.
10. The tailoring function echoed upstream error text. Now generic.
11. A location of "Panama City, FL" was treated as Central America. Fixed.

## Robustness

- Hostile text in every job, company, backup, and note field is shown as text and never runs. Script links are neutralised.
- A broken, empty, or oddly shaped job file shows a plain message or an empty-list hint.
- Corrupt saved data starts fresh.
- 400 jobs re-sort in under a second on a modest machine. A normal list is well under 100.
- A site that fails to load never marks its jobs closed. A job is closed only when the board loads and the job is gone. Closed jobs drop off after 60 days.

## Not tested, so check these yourself

- **Live company sites.** The crawler was tested against stand-in data. The first real run is the real test. Expect some employers to need their link fixed.
- **A real Claude API call.** The tailoring function was tested with a stand-in for the API.
- **A real Vercel deployment**, including whether the headers in `vercel.json` apply as written.
- **Real screen readers** (VoiceOver, NVDA, TalkBack) and real phones. The automated checks cover structure and behaviour, not how it sounds.
- **Safari and Firefox.** Tests ran in Chromium only.
- **Install prompts** on each phone and laptop. These differ by browser.
