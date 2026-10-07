# Remote roles watch

A private job watch. Twice a week it reads the careers pages of a set list of employers, keeps the roles that match, and shows them on a dashboard with pay, location notes, days open, deadlines, why each one fits, and concerns.

No personal names or details are stored in this project. The match criteria live in `data/profile.json`. Stars, statuses, notes, resumes, and cover letters are saved only in the browser of the person using the dashboard.

See `SECURITY.md` for the security review and `QA-REPORT.md` for what was tested.

## Launch (about 20 minutes)

1. **Create the repository.** On GitHub, make a new **private** repository. Then either:
   - **From a computer:** upload everything in this folder and keep the folder structure. Check that the `.github` folder made it. It is hidden on some computers, and without it nothing runs on a schedule.
   - **From a phone, no unzipping:** in the repository choose Add file, Create new file, name it `.github/workflows/check-jobs.yml`, paste in the contents of that file, and commit. Then choose Add file, Upload files, pick `job-watch.zip` as it is, and commit. GitHub unpacks the zip, deletes it, and runs the first check by itself, so skip step 4.
2. **Connect Vercel.** In Vercel, choose Add New, Project, and import the repository. Framework preset: Other. Leave the build command empty. Deploy. `vercel.json` sets the output folder and the security headers.
3. **Open the site.** You should see six starter rows and a yellow notice saying they come from a manual test. That confirms the dashboard works.
4. **Run the first live check.** In GitHub, open the Actions tab, choose "Check job sites", and press "Run workflow". It takes a few minutes. When it finishes it commits a new job list and Vercel redeploys by itself.
5. **Fix the links that failed.** Open the dashboard, go to Companies, and read the Site check section. It has a box listing every site that failed and why, with a button to copy the list. See "After the first run" below. Expect this the first time.
6. **Turn on tailored drafts (optional).** See below.
7. **Hand it over.** Send the link. On first open, each device offers to add the site to the home screen or dock.

After that it runs by itself every day at 11 in the morning, Eastern time. GitHub often starts scheduled jobs 5 to 20 minutes late.

If step 4 fails at "Save results" with a permission error, go to the repository's Settings, Actions, General, Workflow permissions, choose "Read and write permissions", and run it again.

## After the first run

The starter list has 50 employers. Seven have a hiring system that was confirmed by hand. The rest are set to `"ats": "auto"`, which means the check opens the careers page and works out the hiring system. Some will fail, because a careers link is out of date or the page hides its job board.

For each company that could not be read:

1. Open its careers page in a browser and click any job.
2. Look at the address bar. If you see `greenhouse.io/NAME`, `jobs.lever.co/NAME`, `jobs.ashbyhq.com/NAME`, `NAME.breezy.hr`, or `NAME.wdN.myworkdayjobs.com/SITE`, put that link in the company's `careers` field in `data/companies.json`.
3. If it uses something else, add `"skip": "uses an unsupported hiring system"` to pause it.

Commit the change, then run the workflow again.

## Turn on the dashboard's buttons

Three things on the dashboard call small functions on Vercel. In Vercel, open Settings, Environment Variables, add what each needs, then redeploy.

| Button | Needs | Passphrase? |
|---|---|---|
| **Check this link** (Companies) | Nothing | No |
| **Check for new jobs now** and **Save to the watch list** | `GITHUB_REPO` set to `your-github-name/your-repository-name`, and `GITHUB_TOKEN` (see below) | No |
| **Draft tailored versions** | `ANTHROPIC_API_KEY` and `ACCESS_CODE`, a passcode of 5 or more characters | Yes, once per device |

The first three are open to anyone who has the site link. In place of a passphrase they have limits: a check can be started once an hour (change with `RUN_GAP_MINUTES`), link checks are limited to 30 an hour per visitor, and saves to 12 an hour per visitor. Tailored drafts keep the passphrase because each one spends API credit.

**Making the GitHub token.** On GitHub: your photo, Settings, Developer settings, Personal access tokens, Fine-grained tokens, Generate new token. Choose "Only select repositories" and pick this one repository. Under Repository permissions set **Actions** to Read and write and **Contents** to Read and write. Leave everything else alone. Copy the token into Vercel. It expires on the date you choose, and the two buttons stop working until you make a new one.

## Job boards

Job boards are a second source. Their listings are marked "From a job board" with a blue edge, can be hidden with the "Job board listings" checkbox, and are dropped when the same job is already found on a company's own site.

- **Remotive**, **Jobicy**, and **Working Nomads** are read with no setup. They lean toward tech, so expect few matches.
- **Adzuna** covers far more. Get a free key at developer.adzuna.com, then in GitHub open Settings, Secrets and variables, Actions, and add `ADZUNA_APP_ID` and `ADZUNA_APP_KEY`.
- **USAJOBS** covers federal jobs, including the Smithsonian and the Fish and Wildlife Service, and lists closing dates. Get a free key at developer.usajobs.gov, then add `USAJOBS_KEY` and `USAJOBS_EMAIL` the same way.

Job board listings are kept or dropped on three things only: the job title, the location, and the pay. No company is filtered out. A company whose name suggests oil, gas, coal, or mining gets a caution note. The search words are `boardSearches` and `boardWords` in `data/profile.json`.

## Turn on tailored drafts (optional, Vercel only)

The "Draft tailored versions" button sends the base resume, base cover letter, and job description to Claude and returns a first draft.

1. In the Claude Console, create an API key in its own workspace and set a low monthly spend limit on that workspace. Each draft costs a few cents.
2. In Vercel, open Settings, Environment Variables, and add:
   - `ANTHROPIC_API_KEY`: the key from step 1.
   - `ACCESS_CODE`: the passcode. It is set here in Vercel, never stored in the project files.
   - `TAILOR_MODEL` (optional): defaults to `claude-sonnet-5-5`.
3. Redeploy.
4. Share the passphrase privately, not in the same message as the site link.

API reference: https://docs.claude.com/en/api/overview

## Updating the project later

Upload a new `job-watch.zip` to the top level of the repository (Add file, Upload files from the repository's home page). The workflow unpacks it over the existing files, keeps the live job list, deletes the zip, and runs a check. Note that this replaces `data/companies.json` and `data/profile.json` with the versions in the zip.

Editing `data/companies.json` or `data/profile.json` directly on GitHub also starts a check.

## What counts as a match

- Fully remote roles, on site or hybrid roles in South Florida, roles based in Central America, and roles based in Barbados or the wider Caribbean. The place lists are in `data/profile.json`.
- Pay floor: $80,000 base, or $50,000 for Barbados and Caribbean roles. If a posting lists a pay range, the low end has to meet the floor. Postings with no pay listed are kept and say so. Pay shown in Barbados dollars is converted at 2 to 1.
- Contract roles are compared against a $55 an hour floor.
- Field work, habitat restoration, and species monitoring are called out under "Why it fits".
- Each job shows days open. If the company gives no post date, it shows days since the check first saw it.
- If a posting gives an application deadline, the job shows "Apply by" with days left, and jobs past their deadline are dropped. Most postings give no deadline, and those say so.
- Employers marked `"focus": "mixed"` carry a caution about business outside clean energy.

Fit and concerns come from keyword rules in `crawler/analyze.js`. They are a first screen, not a judgment.

## Add a company

Add an entry to `data/companies.json`:

```json
{ "id": "short-name", "name": "Company Name", "type": "renewable", "focus": "renewable", "region": "US",
  "hq": "City, ST", "about": "One or two sentences on what they do.", "careers": "https://...", "ats": "auto" }
```

- `id`: lowercase letters, numbers, and dashes only, and unique.
- `type`: `renewable`, `conservation`, `consulting`, or `other`.
- `focus`: use `mixed` if the company or its parent has fossil fuel business.
- `region`: `Caribbean` treats every job as a Barbados-area role with the lower pay floor.
- `careers` must start with `https://`.

The dashboard has an "Ask to add a company" box. Requests stay in the user's browser, and they can copy the list and send it to you.

## Things to know

- **Two devices, two sets of marks.** Statuses, stars, notes, and documents are saved per browser. A phone and a laptop do not sync. "Save a backup" and "Load a backup" move statuses, stars, notes, and the base resume text between devices. Uploaded files and the access code stay on the device they were added to.
- **The site has no login.** It is marked no-index and holds no personal details, but anyone with the link can see the job list.
- **Closed jobs.** If a posting disappears from the company's board, it is marked closed. Jobs with an application in progress stay in the Applications list.
- **If a check goes badly wrong.** When more than 90% of sites fail in one run, the check keeps the last good list and the workflow shows as failed.

## Files

| Path | What it does |
|---|---|
| `public/` | The dashboard: `index.html`, `app.js`, `style.css`, the app icon, and `data/jobs.json`. No build step. |
| `crawler/` | The check. `run.js` runs it, `check.js` holds the logic, `adapters.js` reads each hiring system, `analyze.js` does the matching. |
| `data/companies.json` | The employers being watched. |
| `data/profile.json` | Pay floors, places, years of experience, travel limit. |
| `.github/workflows/check-jobs.yml` | The schedule. |
| `api/` | Small functions behind the passphrase: `run.js` starts a check, `verify.js` tests a careers link, `company.js` saves a company, `tailor.js` drafts documents. |
| `lib/` | Shared code for those functions. |
| `tests/` | Automated checks. |

`npm test` runs the checks in the `tests` folder for the matching rules, crawler safeguards, and the site's functions. `npm run crawl` runs a check on your own computer. Both need Node 20 or newer and nothing else.
