# Job Bench v2 — Part-Time / Remote, Updated Daily

An updated version of Job Bench, built around what you actually asked for:
remote or part-time work you can juggle with school, listings from the last
24–48 hours, a rough ₦100k/month minimum, and a profile + resume you fill in
once so every application starts from a ready-made note instead of a blank
form.

## What this is — and isn't

- **It IS**: a job board that refreshes itself daily, filters for
  remote/part-time/flexible listings posted recently, and generates a
  tailored application note (copied to your clipboard) so applying is
  "review → paste → send" instead of retyping your info every time.
- **It is NOT**: a bot that submits applications on other websites for you.
  Every job site has a different form, and silently automating submissions
  to sites that haven't agreed to that breaks their terms of service — so
  this deliberately stops one click before "send," and you stay in control
  of what actually goes out.

## Setup (same as before — 5 minutes)

1. Create a new GitHub repo (or reuse your existing Job Bench repo) and push
   these files, keeping the folder structure as-is (`.github/workflows/`,
   `scripts/`, `index.html`, `jobs.json`).
2. **Settings → Pages** → Source: **Deploy from a branch**, branch **main**,
   folder **/ (root)**. You'll get a URL like
   `https://<username>.github.io/<repo>/`.
3. **Actions tab** → enable workflows if prompted → open "Update Job Bench
   listings" → **Run workflow** once, to do the first fetch immediately
   instead of waiting for the daily schedule.
4. Open your Pages URL, fill in your profile once (name, email, phone,
   skills, a short pitch, and your resume file), and hit **Save profile**.
   That's stored only in your browser's local storage — it never gets
   written back to the repo, so it won't follow you to another device.

## How the filters work

- **Remote / part-time / flexible**: a listing is tagged this way if its
  title, description, or tags mention "part time," "remote," "contract," or
  "freelance." This is a keyword match against the source data, not a
  guarantee — always confirm on the actual listing.
- **Posted within 48 hrs**: computed from each source's own posted date.
  Listings with no usable date from the source are kept but shown as "Date
  unknown" rather than dropped.
- **Min pay ₦100k/month**: most of these APIs report USD (often per year),
  so `scripts/update-jobs.mjs` does a rough USD→NGN conversion
  (`USD_TO_NGN` constant, currently 1600 — edit it as the real rate moves)
  and estimates a monthly figure. A large share of listings simply don't
  list pay at all — those show as "Not listed" and aren't excluded by the
  pay filter, since excluding them would hide good options that just didn't
  publish a number.
- **Weekend availability**: not something these APIs report at all, so
  there's no automatic filter for it — that's genuinely something you check
  per listing.

## Where listings come from

Same three sources as before, all public/documented APIs — no scraping of
sites that don't offer one:

- [Jobicy](https://jobicy.com/jobs-rss-feed)
- [Arbeitnow](https://www.arbeitnow.com/api/job-board-api)
- [Remote OK](https://remoteok.com/api)

Nigeria-specific boards (Jobberman, MyJobMag, HotNigerianJobs, Indeed,
LinkedIn) don't publish public APIs, so they're not pulled in automatically.
Worth checking those directly for local, naira-denominated listings this
tool won't see.

## Editing your target roles

Open `scripts/update-jobs.mjs` and edit the `KEYWORDS` array near the top —
add or remove terms and adjust their weights any time your target roles
change. No other code needs to change.

## Known limitations

- GitHub disables scheduled workflows after 60 days of repo inactivity —
  run the Action manually once if that happens.
- Scheduled runs can slip 15–30 minutes at busy times.
- The USD→NGN rate is a hardcoded estimate, not live — update it in
  `update-jobs.mjs` periodically.
- Resume upload is stored as a local file reference in your browser only
  (not parsed or sent anywhere) — it's there so the app can remind you
  which file to attach, not to auto-attach it to external forms.
