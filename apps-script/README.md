# Google Sheets backend setup

The public website runs on GitHub Pages. A Google Apps Script web app receives responses and appends them to a private Google spreadsheet. No Dropbox, Cloudflare account, API key, or server is needed for this backend.

## 1. Create the Apps Script project

1. Open [Google Apps Script](https://script.google.com/home/start) in the Google account that should own the survey results.
2. Create a new project named **CrossFit Bethesda Survey Receiver**.
3. Replace the default `Code.gs` contents with the entire generated [Code.gs](./Code.gs) file in this folder. Do not also paste `Receiver.gs`: its contents are already included in the generated file.
4. Save the project.

`Code.gs` is included in the repository package. To regenerate it after changing the schedules or backend sources, run `npm run build:backend` or `npm run build` locally. There are no package dependencies to install.

## 2. Set the website origin

In Apps Script, open **Project Settings → Script properties → Add script property**:

| Property | Value |
| --- | --- |
| `ALLOWED_ORIGINS` | `https://YOUR-ACCOUNT.github.io` |

Use the site's **origin**, without its repository path or a trailing slash. For a site at `https://YOUR-ACCOUNT.github.io/class-time-survey/`, the value is `https://YOUR-ACCOUNT.github.io`.

For a custom domain, use that origin instead. To also permit the local preview, use a comma-separated value:

```text
https://YOUR-ACCOUNT.github.io,http://127.0.0.1:4173
```

This setting restricts where the save receipt is sent. It does not authenticate gym membership or stop other software from submitting to a public endpoint.

## 3. Create the private results spreadsheet

1. Return to the Apps Script editor.
2. Select **setup** from the function dropdown and click **Run**.
3. Review and authorize your own script's requested Google permissions. The script uses spreadsheet access to create/store responses and your email identity to restrict setup to the owner.
4. Open the spreadsheet URL printed in the execution log.

The setup function creates **CrossFit Bethesda Survey Responses**, adds the `Responses` and `Attendance` tabs, and saves its ID in the project's `SPREADSHEET_ID` Script Property. Running setup again reuses it and does not erase existing responses.

Keep the spreadsheet's sharing setting **Restricted**. Share it only with the gym leadership accounts that should analyze results. Members do not receive spreadsheet access. Authorized spreadsheet editors can still change data; the file is not immutable storage.

To use an existing spreadsheet, first set `SPREADSHEET_ID` to its ID in Script properties, then run setup. Tabs named `Responses` or `Attendance` must be empty or have the expected headers; setup refuses to overwrite an incompatible table.

## 4. Deploy the receiver

In Apps Script:

1. Choose **Deploy → New deployment**.
2. Choose deployment type **Web app**.
3. Set **Execute as** to **Me**.
4. Set **Who has access** to **Anyone** so members can submit without a Google sign-in.
5. Deploy and copy the Web app URL ending in `/exec`.

If your Google Workspace account does not offer anonymous **Anyone** access, an administrator must allow that deployment mode, or the receiver must be deployed from an account that supports it. The website cannot override that account policy.

Opening the deployed URL shows a small health-check response. It never returns survey results or the spreadsheet ID.

See [Google's web app deployment documentation](https://developers.google.com/apps-script/guides/web).

## 5. Connect the website

Edit `site/config.js`:

```js
window.SURVEY_CONFIG = {
  gymName: "CrossFit Bethesda",
  storage: "apps-script",
  endpoint: "https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec",
  turnstileSiteKey: ""
};
```

Commit and push that file to GitHub. The existing GitHub Pages workflow publishes the updated website. The deployment URL is public; no Google password, OAuth token, spreadsheet ID, or Wodify key belongs in the website configuration.

## 6. Test the deployed connection

Open the actual GitHub Pages survey in a private browser window, submit a test response, and verify:

- The website shows its thank-you page only after a positive save receipt.
- `Responses` gains one row with `save_status` set to `saved`.
- `Attendance` gains 75 rows for the current survey: 31 current and 44 proposed class answers.
- Classes left unchanged have `never` as their attendance value.

The local automated tests exercise validation, retries, interrupted writes, formula-like comments, and the browser receipt protocol. They do not replace this test against your deployed Google account.

If a submission times out, it may already have been saved. Retry on the same page: the response ID remains the same and prevents duplicate rows. A failed or missing receipt never displays a false success. If you change answers after a confirmed save, submit a new response rather than trying to edit the saved one.

If the connection fails, check **Apps Script → Executions**, the exact `ALLOWED_ORIGINS` value, `/exec` rather than `/dev`, and the deployed access setting. Browser extensions that block Google frames may also block save confirmations.

## Stored data and analysis

`Responses` has one row per submission: response ID, server/client timestamps, survey version, barriers, comments, optional email/consent, the original structured JSON, a fingerprint, save status, and the required `member_name`. The raw JSON also includes `memberName` and retains the canonical class details even if future schedules change.

`Attendance` has one row per respondent/class: response ID, current/proposed schedule, class ID, weekday, time, program, attendance category, server receipt timestamp, and `member_name`. Every class rating is attached to the submitted name as well as the response ID. Names are self-reported, not verified identities. This supports pivot tables or a separate private dashboard reading the same spreadsheet.

When upgrading an existing receiver, replace `Code.gs`, run `setup`, and deploy a new version of the existing web app. Setup adds the trailing `member_name` column to both previous-schema tabs without rewriting historical responses. Older anonymous responses remain unnamed; all new submissions require a nonblank name of up to 120 characters. Email remains optional.

The `pending` state records an interrupted save; a retry completes missing attendance rows before marking the response `saved`. Concurrent submissions use a script lock. Reusing a response ID with changed answers cannot overwrite an earlier response.

The public app exposes only submission and health-check endpoints, not a results/edit endpoint. Setup is restricted to the signed-in owner; storage helper functions are private to Apps Script. Do not add public dashboard/read functions to this anonymous receiver. A future dashboard should have its own restricted deployment.

This minimal receiver validates payloads and includes a honeypot, but does not enforce one response per member or include a CAPTCHA. Google Apps Script's account quotas still apply. If significant spam becomes a problem, add bot verification or use the optional Worker backend rather than exposing a credential in the static website.

## Updating the backend

After changing a schedule or backend logic, regenerate `Code.gs`, replace it in Apps Script, and use **Deploy → Manage deployments → Edit → New version → Deploy** to keep the same endpoint URL. Push the matching website changes to GitHub. Existing stored responses are preserved.
