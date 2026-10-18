# CrossFit Bethesda Class Time Survey

A static member survey prepared for GitHub Pages. No frontend dependencies or installation step are required. GitHub Actions tests the source, builds the public files, and deploys the site after each push to `main`.

The Google Apps Script/Sheets backend is included, and `site/config.js` contains the supplied deployment URL. Before inviting members, set the deployed site's origin in the script's `ALLOWED_ORIGINS` property and verify a real submission reaches the private spreadsheet. A separate private dashboard can later read the results spreadsheet; no dashboard has been deployed.

Follow [Google backend setup](apps-script/README.md) to create the private response spreadsheet, deploy the receiver, and connect it to GitHub Pages. No Dropbox or Cloudflare account is needed for this approach. The older Cloudflare Worker/D1 template remains an optional alternative.

## Deploy this repository

1. Create an empty GitHub repository with `main` as its default branch.
2. Add this folder's contents at the repository root, including `.github/workflows/`, `.gitignore`, `package.json`, `scripts/`, `site/`, `shared/`, `apps-script/`, `tests/`, and the optional `worker/` template. Do not upload the parent gym-purchase folder. If using the prepared ZIP, extract it first; uploading the ZIP itself does not deploy a site.
3. Open **Settings → Pages → Build and deployment** and set **Source** to **GitHub Actions**.
4. Open **Actions → Deploy class time survey to GitHub Pages → Run workflow**. Later pushes to `main` deploy automatically.
5. Open the website link shown by the completed deployment. A repository site normally uses `https://YOUR-ACCOUNT.github.io/YOUR-REPOSITORY/`.

The build needs Node.js 22.13+; the workflow supplies Node.js 24. It runs `npm test` and `npm run build` without `npm install`, since the frontend has no external dependencies. Pull requests run the same checks without deploying.

The workflow follows [GitHub's custom Pages workflow](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages). If Pages is unavailable for the chosen repository/account, check the repository's Pages settings before running the workflow.

## What gets published

Only `dist/` is uploaded to GitHub Pages. The build copies an explicit list of public files from `site/`: HTML, CSS, JavaScript, the social image, and `.nojekyll`. The response-service source, tests, local environment files, and project documents are not included in that website artifact. Repository contents may still be visible according to the repository's own access settings.

Asset and module paths are relative, so the same build works at a repository path, an account-root site, or a custom domain. GitHub provides the deployed URL to the build, which writes the canonical link and absolute social-preview image URLs automatically. To generate those URLs manually:

```bash
SITE_URL=https://YOUR-ACCOUNT.github.io/YOUR-REPOSITORY/ npm run build
```

For an ordinary local preview, use `npm run dev` and open `http://127.0.0.1:4173/`. No deployment URL is needed.

## How responses are saved

GitHub Pages can safely serve public HTML, CSS, and JavaScript, but it cannot keep a password, API key, or database credential secret. Anything placed in `site/` is visible to visitors.

The Google backend uses:

```text
Member browser -> GitHub Pages (public form)
               -> Google Apps Script (validation, append, save receipt)
               -> Google Sheets (private Responses and Attendance tabs)
```

The form posts into a hidden Google frame and waits for a receipt tied to that submission. It does not use an opaque `no-cors` fetch response as proof of storage. Apps Script sends a positive receipt only after the response and class-answer rows are saved. Retrying the same response ID does not create duplicates, and does not permit changes to previously saved answers.

## Project structure

- `site/` - the complete static website published to GitHub Pages
- `apps-script/Code.gs` - complete Google backend to paste into Apps Script
- `apps-script/Receiver.gs` - receiver source used to generate Code.gs
- `shared/` - validation source used by the Google backend build
- `worker/` - the separate response API and D1 schema
- `.github/workflows/deploy-pages.yml` - tests, build, and GitHub Pages deployment
- `.github/workflows/check.yml` - pull request checks without deployment
- `scripts/` - small local preview and build helpers
- `tests/` - source and security checks

## Customize the survey

Edit `site/config.js`:

```js
window.SURVEY_CONFIG = {
  gymName: "CrossFit Bethesda",
  storage: "apps-script",
  endpoint: "https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec",
  turnstileSiteKey: ""
};
```

The preview banner disappears when the Apps Script URL is configured. Deploy and test the actual Google receiver before inviting members. Do not add any secret to this file.

The survey has three pages: reported attendance on the current schedule, expected attendance on the proposed schedule, and final comments/contact details. Both calendars separate the work week from the weekend and keep their answers independent.

Every class defaults to `never`, so members can continue without rating each class. Weekday time shortcuts apply a choice to every existing Monday–Friday class at that exact time on the current page. Individual classes remain editable; a shortcut shows “Mixed” when the matching weekdays have different answers. Weekend classes and the other schedule page keep their own choices.

`site/schedule.js` contains the current CrossFit schedule snapshot. `site/proposed-schedule.js` contains the 44 CrossFit classes from the supplied `Schedule.xlsx` (Daily schedule). Friday afternoon uses the separate time cells in column G. Weekend times use columns I and K. The spreadsheet's template dates do not set a launch date, and other programs are excluded.

Responses store the two calendars separately as `classAttendance` and `proposedAttendance`, each with a class ID, day, time, program, and attendance status.

The first page requires a self-reported name (`memberName`, up to 120 characters). Both browser and backend reject missing or whitespace-only names. Google Sheets stores `member_name` on the response and on every attendance row; email remains optional. See the Apps Script setup guide for upgrading an existing receiver without changing historical responses.

## Optional: connect the Cloudflare response template

These steps apply only if choosing the included Cloudflare backend instead of Google Sheets. Set `storage: "worker"` in `site/config.js` and configure both its endpoint and public Turnstile site key. Keep the Turnstile secret in Cloudflare.

These steps require a Cloudflare account and Wrangler.

1. From `worker/`, install its development dependency:

   ```bash
   npm install
   ```

2. Log in, create the D1 database, and copy the returned database ID into `worker/wrangler.jsonc`:

   ```bash
   npx wrangler login
   npx wrangler d1 create class-time-survey
   ```

3. Set `ALLOWED_ORIGIN` to the exact GitHub Pages origin, such as `https://YOUR-NAME.github.io`. Set `ALLOWED_HOSTNAME` to the same hostname without `https://`.

4. Apply the schema (for a new database; an existing pre-name database first needs `ALTER TABLE survey_responses ADD COLUMN member_name TEXT NOT NULL DEFAULT '';` applied once, preserving older unnamed responses):

   ```bash
   npm run db:apply:remote
   ```

5. Create a Turnstile widget in Cloudflare for the GitHub Pages hostname. Put the public site key in `site/config.js`. Store the secret only in Cloudflare:

   ```bash
   npx wrangler secret put TURNSTILE_SECRET
   ```

6. Deploy the Worker and put its returned URL in `site/config.js`:

   ```bash
   npm run deploy
   ```

7. Republish the GitHub Pages site.

## Review and export Cloudflare results

Responses are private in D1. They can be viewed in the Cloudflare dashboard or queried with Wrangler. For example:

```bash
npx wrangler d1 execute class-time-survey --remote --command \
  "SELECT json_extract(c.value, '$.day') AS day, json_extract(c.value, '$.time') AS time, json_extract(c.value, '$.status') AS attendance, COUNT(*) AS responses FROM survey_responses AS s, json_each(s.proposed_attendance_json) AS c GROUP BY day, time, attendance ORDER BY day, time, attendance"
```

Before opening the survey, decide who may access exports, how long raw responses will be retained, and when optional email addresses will be deleted. Avoid exporting contact emails unless the analysis actually needs them.

## Optional Cloudflare controls

- HTTPS on GitHub Pages and Cloudflare Workers
- exact-origin CORS allowlist; no wildcard origins
- mandatory server-side Turnstile validation
- strict enum, length, UUID, email, and payload-size validation
- parameterized D1 statement to prevent SQL injection
- honeypot, no-store response headers, and no IP-address storage
- optional email with explicit contact consent
- idempotent response IDs to prevent accidental duplicate inserts

This reduces abuse and protects the database credentials, but a public survey cannot prove that every respondent is a current member. If member-only access or one-response-per-member enforcement becomes necessary, add authenticated magic links or use an identity provider rather than placing a shared password in the static site.

## Local commands

```bash
pnpm dev     # preview at http://127.0.0.1:4173
pnpm test    # run source and security checks
pnpm build   # copy the static site to dist/
```

The equivalent `npm run dev`, `npm test`, and `npm run build` commands also work. After adding a new public asset, add it to `publicFiles` in `scripts/build.mjs` so it is deployed.

## Scheduling basis

The survey design follows the *CrossFit Affiliate Playbook*, “Building a Class Schedule” and “How Class Schedule Impacts Your Financial Model” (PDF pp. 62–64): grow offerings with the current member base, weigh member demand against coaching and operating costs, and survey current members before committing to schedule changes. The Playbook is business guidance, not a substitute for current legal, privacy, tax, insurance, or employment advice.
