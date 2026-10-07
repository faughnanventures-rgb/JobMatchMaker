# Security review

Reviewed before launch. This lists what could go wrong, what is in place, and what is left for you to decide.

## What is being protected

1. The job seeker's privacy. He is employed and searching quietly.
2. Your Claude API credit.
3. The integrity of the job list, so nobody can plant a fake or malicious posting.
4. Your GitHub repository.

## Where personal data lives

| Data | Where it is | Who can reach it |
|---|---|---|
| Job list, company list | Public site | Anyone with the link |
| Match criteria (pay floors, places) | Private repository | You |
| Statuses, stars, notes, base resume text | His browser storage, per device | Anyone using that device and browser |
| Uploaded resume and cover letter files | His browser database, per device | Same |
| Resume text during a tailoring request | Passes through the Vercel function to the Claude API | Not stored or logged by this project |
| Access code | His browser storage. Never in a backup file. | Same as above |

His name is not in the repository or on the site.

## Controls in place

**Dashboard**
- Every piece of text from a job posting, company page, backup file, or saved note is escaped before it is shown. Links are limited to http and https.
- A content security policy allows scripts, styles, and data only from the site itself. No inline script, no inline styles, no outside fonts, analytics, or trackers. The site makes no third-party requests.
- Headers: HSTS, no-sniff, no framing, no referrer, a locked-down permissions policy, and no-index. Because of the no-referrer policy, employers do not see where a click came from.
- Backup files are validated field by field on load. Unknown fields and wrong types are dropped, and special keys that could alter built-in objects are refused.
- Uploads are capped at 10 MB and never leave the device.

**Tailoring function**
- Refuses to run unless a passcode of 5 or more characters is set. A short numeric code is the owner's choice. It is easy to share and easy to guess, so the limits below and the spend cap on the API key are what really protect the credit.
- Compares the passcode in constant time, waits before answering a wrong one, locks an address out for 15 minutes after five misses, and locks everyone out for the rest of the hour after 20 misses in total.
- Accepts requests only from the dashboard on the same site, only as JSON, and caps the size.
- Treats the job description as untrusted. It is wrapped in tags, the model is told it is material and not instructions, and closing tags smuggled into any field are stripped. The model has no tools and its output is shown as plain text.
- Returns generic errors. Upstream error text and resume text are never logged or passed back.

**Run now, link check, and save a company (open, no passphrase, by the owner's choice)**
- Anyone who has the site link can use these. They accept same-site JSON requests only and have size caps, which stops other websites from calling them from a visitor's browser. It does not stop someone who writes a script.
- Limits stand in for the passphrase: one check start per hour, 30 link checks per visitor per hour, 12 saves per visitor per hour. The per-visitor counts reset when the function restarts, so treat them as a speed bump.
- The link checker refuses anything that is not a public https address, including after redirects, so it cannot be pointed at internal systems. It returns only job titles.
- The GitHub token stays on the server and is never sent to the browser. It should be a fine-grained token limited to this one repository with only Actions and Contents permissions.
- Saving a company only ever changes `data/companies.json`. Names are stripped of markup, the type is limited to a fixed list, the link must pass the public https test, and the list is capped at 300. A save does not start a check by itself.
- Tailored drafts still need the passphrase, because that function spends money.

**Job boards**
- Only boards with a public feed meant for this use are read. Optional keys are GitHub secrets and are scrubbed from any error text before it reaches the dashboard.

**Crawler**
- Reads only public https addresses. Localhost, private network ranges, raw IP addresses, and cloud metadata addresses are refused, including after a redirect.
- Hiring system feeds are requested only from their known hosts. Board names are validated before they go into an address.
- Response size, page text, and field lengths are capped.
- Zero third-party packages, so there is no dependency supply chain to watch.
- The workflow can write to this one repository and nothing else. It uses one action, published by GitHub. It has no secrets.

## Risks that remain, and what to do

| Risk | Level | What to do |
|---|---|---|
| Passcode guessing. A 5-digit code has 100,000 possibilities. The lockouts slow guessing to about 20 tries an hour, but they reset when the function restarts. | Medium with a short code | Set a low monthly spend limit on the API workspace. That limit is the real backstop. Use a longer code if the spend limit is ever raised. |
| Anyone with the link can read the job list, which hints at a job search in this field. | Low | Do not post the link. If that is not enough, add Vercel password protection or a login. |
| A shared or lost device exposes his notes and resume. | Depends on the device | Use it only on his own devices with a screen lock. |
| A compromised employer careers page feeds a misleading posting. | Low | Text cannot run as code. The apply link goes to the employer's own site. Treat any posting that asks for money or odd personal details as fake. |
| The GitHub action is pinned to a version tag, not a fixed commit. | Low | Pin `actions/checkout` to a commit SHA if you want it frozen. |
| Someone who finds the site link adds junk companies or changes a company's careers link. | Low to medium | Every change is a commit in the repository history, so it can be seen and undone. If it happens, add a passphrase back or turn on Vercel password protection. |
| Someone who finds the link starts a check every hour. | Low | That would use up the free GitHub Actions minutes in about two weeks, and checks would stop until the next month. There is no charge unless you have raised the spending limit. |
| The GitHub token in Vercel can change files in this repository. Visitors cannot read it. | Low | Limit the token to this repository. Set an expiry and renew it. |
| The API key sits in Vercel. | Low | Keep it in its own workspace, rotate it if the Vercel account is ever shared. |
| No central rate limit on the tailoring function. | Low to medium | If your Vercel plan offers firewall rate limiting, add a rule for `/api/tailor`. |

## Not covered by this review

- A penetration test against the live deployment. This was a code review plus automated tests in a local browser.
- Vercel, GitHub, and Anthropic account security. Turn on two-factor sign-in on all three.
