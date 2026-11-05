# Testing

How this repo is checked, what each check covers, and where a new test goes.

```bash
npm run lint          # oxlint over the whole repo
npm test              # unit tests + API smoke tests + translation keys
npm run build         # vite build — catches broken imports and JSX
npm run test:api:mongo   # the smoke tests against a real MongoDB (needs MONGODB_URI)
```

## The layers

| Layer | Command | Covers | Speed |
| --- | --- | --- | --- |
| Lint | `npm run lint` | Hook rules, undefined names, likely bugs ([.oxlintrc.json](.oxlintrc.json)) | < 1 s |
| Unit | `npm run test:unit` | Pure client helpers in `src/lib/` — no React, no DOM ([test/unit/](test/unit/)) | < 1 s |
| API smoke | `npm run test:api` | Every route over real HTTP against the in-memory store: accounts, consent and withdrawal, sessions, marking, tutor (scripted), uploads, events, labelling ([server/smoke.mjs](server/smoke.mjs)) | ~ 5 s |
| Strings | `npm run check:strings` | Every `t('…')` key exists in both EN and TR ([server/strings.mjs](server/strings.mjs)) | < 1 s |
| Build | `npm run build` | The client compiles | ~ 2 s |
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
   helper and unit-test it if you can; otherwise list the manual check in the PR.

When changing behaviour that has no test, write a test for the current
behaviour first, then change it, so the diff shows what changed on purpose.

## Gaps, in the order worth closing

1. **No component tests.** The consent checkboxes, the withdrawal button and the
   photo replace/remove UI are only checked by hand. Next step: Vitest +
   React Testing Library + jsdom (dev dependencies only, reusing the Vite
   config), starting with `ConsentScreen`, `QuestionPanel` and `QuestionList`.
2. **No end-to-end test of a student's path.** One Playwright test of sign in →
   consent → answer with a photo → withdraw would cover what the smoke test
   cannot: that the screens call the API correctly.
3. **Deploys are not gated on tests.** [deploy.yml](.github/workflows/deploy.yml)
   deploys every push to `main` whether or not CI passes. Either add the CI steps
   as a job the deploy `needs`, or protect `main` so only green PRs merge.
4. **Mongo smoke is manual.** It could run in CI with a `mongo` service
   container.
5. **Lint warnings never fail anything.** There are 9 `only-export-components`
   warnings today; once they are fixed, `oxlint --deny-warnings` keeps it at zero.

## Manual check before merging UI changes

- The changed screen in EN and TR.
- At phone width (375 px): nothing scrolls sideways.
- Keyboard only: focus is visible and nothing traps it.
- File inputs: pick, replace, remove; a wrong file type shows the error line.
