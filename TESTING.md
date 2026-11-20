# Testing

How this repo is checked, what each check covers, and where a new test goes.

```bash
npm run lint          # oxlint over the whole repo
npm test              # unit tests + API smoke tests + translation keys
npm run build         # vite build — catches broken imports and JSX
npm run test:api:mongo   # the smoke tests against a real MongoDB (needs MONGODB_URI)
npm run test:e2e      # the student's critical paths in a real browser (Playwright, Chromium)
```

## The layers

| Layer | Command | Covers | Speed |
| --- | --- | --- | --- |
| Lint | `npm run lint` | Hook rules, undefined names, likely bugs ([.oxlintrc.json](.oxlintrc.json)) | < 1 s |
| Unit | `npm run test:unit` | Pure client helpers in `src/lib/` — no React, no DOM ([test/unit/](test/unit/)) | < 1 s |
| API smoke | `npm run test:api` | Every route over real HTTP against the in-memory store: accounts and roles (staff email sign-in, student-number sign-in, annotators kept out of staff areas, the teacher labelling switch, manager scope), consent and withdrawal, sessions, marking, tutor (scripted), uploads, events, labelling and snippet assignment ([server/smoke.mjs](server/smoke.mjs)) | ~ 5 s |
| Strings | `npm run check:strings` | Every `t('…')` key exists in both EN and TR ([server/strings.mjs](server/strings.mjs)) | < 1 s |
| Build | `npm run build` | The client compiles | ~ 2 s |
| End to end | `npm run test:e2e` | The student's critical paths in Chromium, through the real screens: sign-in, the three consent pages, answering (typed and photo), marking and self-marks, the topic filter, the tutor's ten-turn limit, EN/TR, a returning student, support, the profile and withdrawing, and that an activity's `tutorPrompt` never reaches the browser ([e2e/](e2e/)) | ~ 10 s |
| Mongo smoke | `npm run test:api:mongo` | The same smoke assertions against MongoDB | manual |
| Model check | `npm run check:openai` | One real call to the tutor model — costs money, never in CI | manual |
| Manual | browser | Screens, layout, mobile, file pickers | manual |

## What runs when

- **On every commit**, a git pre-commit hook lints the staged `.js/.jsx/.mjs/.cjs`
  files ([.githooks/pre-commit](.githooks/pre-commit)). Lint *errors* block the
  commit; warnings are printed only. `npm install` installs the hook (the
  `prepare` script sets `core.hooksPath`). Skip it in an emergency with
  `git commit --no-verify`.
- **On every pull request and push to `main`**, [CI](.github/workflows/ci.yml)
  runs lint, unit, API smoke, strings and build.
- **Before a release** that touches the store layer, run `npm run test:api:mongo`
  locally.
- **Before merging a change to a student screen**, run `npm run test:e2e`. It is
  not in CI yet.

## Where a new test goes

1. **A route, a stored field, or a rule the server enforces** (consent, who can
   see what, what an upload replaces) → add assertions to `server/smoke.mjs`,
   next to the section for that route. This is the main safety net: most of the
   app's behaviour lives behind the API.
2. **A pure function in `src/lib/` or `shared/`** (parsing, formatting, file
   checks, numbering) → a `node:test` file in `test/unit/`, named
   `<module>.test.js`. No new dependencies are needed.
3. **A string** → nothing to write: `check:strings` already fails on a key that is
   missing in either language.
4. **A component's behaviour** (a button enabled only when both boxes are ticked)
   → there is no component test layer yet (see Gaps). Move the logic into a pure
   helper and unit-test it if you can; if it is part of a student's path through
   the screens, add it to the matching `e2e/*.spec.js`; otherwise list the manual
   check in the PR.
5. **A student's path through several screens** (sign in → consent → answer →
   come back) → a Playwright test in `e2e/`, next to the spec for that path. See
   [End to end](#end-to-end-browser).

When changing behaviour that has no test, write a test for the current
behaviour first, then change it, so the diff shows what changed on purpose.

## Gaps, in the order worth closing

1. **No component tests.** The consent checkboxes, the withdrawal button and the
   photo replace/remove UI are only checked by hand. Next step: Vitest +
   React Testing Library + jsdom (dev dependencies only, reusing the Vite
   config), starting with `ConsentScreen`, `QuestionPanel` and `QuestionList`.
2. **The e2e suite is not in CI.** It runs locally (see
   [End to end](#end-to-end-browser)); adding it to the workflow is a separate
   decision. It also covers the student side only — the teacher console and the
   class-code (`/join`) door have no browser test.
3. **Deploys are gated on CI, but `main` isn't protected.** A push to `main`
   deploys only after the test job passes, and a manual `npm run deploy:aws`
   runs the tests first unless given `--skip-tests`. A red push to `main` still
   lands on `main` (it just doesn't deploy); protecting `main` so only green PRs
   merge would close that gap.
4. **Mongo smoke is manual.** It could run in CI with a `mongo` service
   container.
5. **Lint warnings never fail anything.** There are 9 `only-export-components`
   warnings today; once they are fixed, `oxlint --deny-warnings` keeps it at zero.

## End to end (browser)

```bash
npm run test:e2e          # the whole suite, headless Chromium
npm run test:e2e -- e2e/tutor.spec.js     # one file
npm run test:e2e:ui       # Playwright's UI mode, to watch or debug a test
npm run test:e2e:report   # the HTML report of the last run (traces of failures)
```

First time on a machine: `npx playwright install chromium` (the browser binary
is not in `node_modules`).

**It starts its own servers and never touches yours.** `playwright.config.js`
starts two processes and stops them when the run ends; a run never reuses a
server it did not start:

| | Port | What |
| --- | --- | --- |
| API | 4410 | [e2e/serve-api.mjs](e2e/serve-api.mjs): `server/index.js` with `MONGODB_URI`, `OPENAI_API_KEY` and `SPACES_*` forced blank before `config.js` is read, so `.env.local` cannot switch on a database, the model or the bucket. It refuses to start if any of them is configured, and `e2e/global-setup.mjs` checks `/api/health` says `memory` / `scripted` / `disk` before any test runs. Uploads go to `$TMPDIR/fe-e2e-uploads`, emptied each start. |
| Client | 5290 | A production build into `e2e/.build` and `vite preview`, proxying `/api` to 4410 ([e2e/vite.config.mjs](e2e/vite.config.mjs)). Never `dist/` or the dev server's cache. |

So it can run while `npm run dev` (5173) and `npm run dev:api` (4000) are up.
`E2E_API_PORT` / `E2E_WEB_PORT` move it if those two ports are taken.

**The tutor is scripted.** With no key, every reply comes from
`shared/tutor-scripts.js` — no network, no bill, the same answer every run.

**Each test seeds its own world** through the API ([e2e/support/seed.mjs](e2e/support/seed.mjs)):
its own teacher, a fresh 8-digit student number on that teacher's class list, and
a published activity. A signed-in student only sees their own teacher's
activities, so tests run in parallel against one server without seeing each
other. Global setup creates the first admin with a known bootstrap token.

**Conventions.** Find things the way a student does — `getByRole`, `getByLabel`,
the words on screen (English unless the test switches to TR) — through the
helpers in [e2e/support/student.mjs](e2e/support/student.mjs). No fixed sleeps:
wait for what the student would wait for (a counter changing, a response
arriving). Add a `data-testid` only when there is no accessible handle. A test
that finds a real bug stays, marked `test.fail()` with the reproduction in a
comment, until the bug is fixed.

Reports, traces and screenshots land in `e2e/.report` and `e2e/.results`
(gitignored).

| Spec | Path |
| --- | --- |
| `sign-in.spec.js` | A listed number signs in; an unlisted one is refused; only 8 digits can be typed |
| `consent.spec.js` | Sheet → form (six boxes) → notice, in order; Back keeps ticks; a reload restarts at page 1; the next sign-in skips it; TR; staff never see it |
| `workspace.spec.js` | Questions listed and opened; a typed answer survives a reload; marking (Revise / Mastered); a photo upload survives a reload; a non-photo is refused; self-marks; the topic filter |
| `tutor.spec.js` | A reply, the turns counter, rating; ten turns then the chat closes, also after a reload |
| `language.spec.js` | EN/TR changes the workspace (Q1 → Soru 1) and is remembered |
| `returning.spec.js` | Signing in again: no consent, "continue where you left off", answer, mark and chat still there |
| `support.spec.js` | Write in, the reply dot, read the reply, answer in the same thread |
| `profile.spec.js` | Username, the sheet again, withdrawing in the first sign-in, closed after the next |
| `privacy.spec.js` | An activity's `tutorPrompt` is in no response the student's browser receives |

## Manual check before merging UI changes

- The changed screen in EN and TR.
- At phone width (375 px): nothing scrolls sideways.
- Keyboard only: focus is visible and nothing traps it.
- File inputs: pick, replace, remove; a wrong file type shows the error line.
