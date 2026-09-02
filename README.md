# Dropshot

A research workspace for studying how AI feedback helps students work through
problems. Teachers write the questions, students work through them talking to a
tutor, and the exchanges that come out get read, kept and labelled to build a
dataset.

React 19 + Vite on the front, Express 5 + MongoDB behind. The API has its own
documentation in [server/README.md](server/README.md); this file is the map.

```bash
npm install
cp .env.example .env          # then MONGODB_URI and OPENAI_API_KEY in .env.local
npm run dev:api               # API on :4000
npm run dev                   # client on :5173, proxying /api
npm run test:api              # 311 end-to-end assertions over real HTTP
npm run check:strings         # every interface string, in both languages
npm run check:openai          # one real call to the tutor's model
```

The interface is in **English or Turkish**, switched by the EN/TR control that
sits on every screen. What a teacher writes — titles, questions, the AI prompt —
is content and is never translated; the chrome around it is, and
`src/lib/strings.js` holds both languages side by side so a gap in one is
visible. `npm run check:strings` fails on a key that is used and missing, or
present in one language only.

## Three audiences, one deployment

| Route | Who | What they do |
| --- | --- | --- |
| `/` | students | Anonymously or signed in, pick an activity |
| `/join`, `/join/:code` | students | The same, reached by a class code or its link |
| `/work/:sessionId` | students | The workspace: question, answer, tutor chat |
| `/teacher` | teachers, managers | Write activities, read student work, label snippets |
| `/admin` | administrators | Accounts |

Every screen carries the same bar of direct buttons — **home, sign in or sign
out, the console for whoever is signed in, and the language switch** — so the way
out of a screen is never a link buried in a paragraph. See
`src/components/TopBar.jsx`. In the workspace that bar sits in a **header across
the top**, alongside the activity title and the student's nickname: it belongs to
the screen rather than to one pane, so collapsing the question list no longer
takes the way out with it.

### Two ways in for a student

- **Anonymously** — no account, no email, no password. Choosing this asks for a
  **nickname** on the next step: optional, and made up. It gives a teacher
  something to call the work on their roster, where the only handle used to be a
  six-character session code. Requiring one would push a child into typing their
  real name, which is the single thing the notice asks them not to do. This is the
  normal way in and what the study is designed around. The workspace header shows
  it back to them — **read-only**, because a student has to be able to answer
  "which one is mine?" and renaming it halfway through would rename work already
  filed under the old name. `nickname` is accepted once, when the session is
  created; no route changes it afterwards.
- **Signed in**, with an email and password their teacher set for them. The list
  is narrowed to their own teacher's work, and the session carries their name so
  it can be followed across visits.

Either way, they get there through a list or through a **class code**: six
characters shown to the teacher, typed at `/join`, or followed as a link
(`/join/ABC234`) put in a lesson plan or a class chat. The editor shows both, with
a button to copy either.

A code is **not a credential**. **Publishing is the whole access decision**: a
draft is invisible and cannot be started — not by id, not by code — and a
published activity is startable by whoever is looking. Closing an activity again
is how a teacher shuts it down. What the code buys is the first two minutes of a
lesson: six characters instead of twenty titles to read.

Activities also carry a **topic** — ratio, whole numbers, or none — and both the
students' list and the teacher's are filtered by it. The list is `TOPICS` in
`shared/activity.js`, and adding one is a line there plus a translation in
`src/lib/strings.js`.

### Who sees the consent notice, and when

**Signing in comes first, the notice second.** The gate sits above every route —
`ConsentGate` in `src/App.jsx` — so it does not matter what a person was about to
open: a teacher heading for `/teacher`, a student with a password heading for `/`,
both hit the same screen first if they have not agreed yet.

| Who | Sees it |
| --- | --- |
| Nobody signed in (anonymous) | Never asked here — see the note below |
| Student, teacher or manager with an account | **Once, ever, immediately after signing in and before anything else.** Checking the box and pressing Submit calls `POST /api/auth/consent`; `user.consented` is what every later sign-in reads |
| Admin | Never |

Bumping `CONSENT_VERSION` asks everybody again, which is the point of having a
version: an agreement to last term's wording is not an agreement to this term's.

The screen itself is `src/components/ConsentScreen.jsx` — a required checkbox and
a Submit button that stays disabled until it is checked. There is no decline
button: the only way off the screen without agreeing is signing out.

**Anonymous sessions are a separate, older mechanism.** `POST /api/sessions`
still refuses to start a session without `consent: true` in the body (see
`server/routes/sessions.js`), but the screen that used to ask an anonymous
visitor for that was removed along with the old `ConsentCard`, and
`StudentEntry.jsx`/`Join.jsx` now send `consent: true` unconditionally. In
practice that means an anonymous, no-account visitor's consent is recorded as
given without ever being asked. That gap predates this gate and is not what it
fixes — it only covers people who sign in.

A token that cannot be checked — the API down, a proxy 502 — is **not** treated as
"anonymous". That fallback would quietly wave a signed-in teacher through as an
anonymous visitor, so the student entry screen says it cannot tell who is asking
and offers a retry instead.

### The student side is students only

A teacher, manager or admin **cannot start a session**. Signed in as staff, the
entry screens do not open at all — `StudentLayout` sends them to their own
console — and `POST /api/sessions` refuses a staff account outright, with or
without a consent flag on the request, so the rule holds against a hand-typed
URL as well as against the buttons.

They used to be able to: a staff walkthrough was allowed and stamped
`staffPreview`, with `consent.given: false` and `waived: 'staff-preview'`, so the
roster could tell it from a student's work. That is gone, and what it bought was
never the walkthrough — it was the filtering afterwards. Every session the study
is read from is now a student's, with a consent record behind it, and nothing has
to be excluded before it can be counted.

Sessions recorded while previews existed keep the flag, and the roster and the
transcript still label them. A reader that stopped checking would quietly recount
a teacher's clicking as somebody's work.

A **student** with an account is not staff, and is asked in the ordinary way.

To see the workspace as a class sees it, open the activity's link in a browser
where you are not signed in. That is a real anonymous session with real consent
behind it — so use a throwaway activity, or delete the session afterwards from
the roster, rather than leaving a walkthrough in the data with nothing to mark it
as one.

**Anonymous is not invisible.** A session with no account still reaches the
teacher, through the activity rather than through a user: they own the activity,
so they see every session started from it, with its transcript and its snippets.
`server/smoke.mjs` asserts that link directly, because it is the one thing that
would quietly lose most of the data if it broke.

### There is no sign-up

Accounts are created downwards and only downwards: an administrator adds
managers and teachers, a teacher adds their own students. An open registration
form would be a hole straight through the hierarchy that `server/services/users.js`
spends its whole length enforcing.

The first administrator comes from `POST /api/auth/bootstrap`, guarded by
`BOOTSTRAP_TOKEN`, which closes permanently the moment any user exists. That is a
deployment step, not a screen — `GET /api/health` reports `ready: false` and says
so while no user exists.

**Most students never get an account.** They open the site or type the class code
their teacher put on the board, agree to the consent notice, and start. The
session is anonymous, and the teacher still sees it, because it is attached to an
activity they own.

## How the pieces fit

```
activity ──< question          a teacher's set of questions; published or not
   │                           carries a class code and a topic
   │
   └──< session ──< answer     one student's run at it — anonymous or named
             │
             └──< message      the tutor thread, per question
                     │
                     └ snippet  one student turn + the reply — the unit of the dataset
```

An **activity** starts as a draft, invisible to students. Publishing is the
single act that opens it, and the server refuses to publish one with no
questions. Unpublishing closes it again without touching anything recorded,
which is why it is offered whenever a delete is refused.

A **question** has to ask something — a typed prompt, an uploaded photo of the
question, or both. Nobody should have to retype a question out of a textbook.
Two further extras are optional and change what the question can do:

- a **rubric** — criteria with keywords — turns on automatic marking with
  per-criterion feedback;
- a **tutor script** — hints, the concept, a worked example, the usual mistake —
  turns on staged hints released one at a time.

Leave both off and the question still works: the tutor answers from the
system-wide prompt and the answer goes to the teacher unmarked. That is a
supported state, not a half-finished one, and `shared/activity.js` holds the
helpers that make it mean the same thing everywhere.

## The tutor

The chat is **OpenAI**, called server-side per turn against the system
prompt the session was stamped with. `server/lib/openai.js` is the client — plain
`fetch`, no SDK — and `server/services/tutor.js` decides who answers, which is
not the same decision every turn:

- **A teacher's own words win.** A hint, a concept explanation or a worked
  example somebody authored is delivered exactly as written. The model does not
  paraphrase teaching, and the escalation stays the server's: hint 2 is not
  readable before hint 1 is asked for, generated or not.
- **The model answers everything else** — free text, "check my reasoning", and
  every turn on a question nobody wrote a script for, which includes all of a
  student's own questions. It reads the question, the rubric's criteria (never
  its keywords), the answer as it stands and the thread so far, and replies in
  the student's chosen language.
- **Scripted lines are the floor.** No `OPENAI_API_KEY`, a timeout, a blocked
  prompt or a rate limit and the student gets a generic line from
  `shared/tutor-scripts.js` rather than an error. The app runs end to end with no
  key at all; `GET /api/health` warns while that is the case, and every reply
  records which of the three wrote it — `openai`, `scripted`, or `fallback` for a
  model call that failed, which is the one worth counting afterwards.

`npm run check:openai` makes one real call and prints what came back. The smoke
test deliberately runs the tutor scripted, so it stays hermetic and free.

A **snippet** is derived from the transcript rather than stored, so it stays
correct as a thread grows. Only the decision about each one — keep it, and how it
scored against the criteria — is persisted.

## What the server owns

The client is not trusted with anything the study will later be read from:

- **Consent.** No route creates a session without it. The UI gate is a courtesy.
- **The mark scheme.** Rubric keywords and tutor scripts never leave the server.
  A student payload carries a criteria *count*, not the criteria.
- **Hint escalation.** The server counts hints and holds their text, so hint 3 is
  not readable before hint 1 is asked for.
- **The model.** The API key, the system prompt and the whole request live on the
  server; the browser sends what the student typed and gets one reply back. A
  client-side call would put the key in the bundle and the prompt up for editing
  by anyone with dev tools — and the prompt is the study's variable.
- **Who can see whom.** Roles and reach are enforced in `services/users.js` and
  `services/activities.js`. The client's copies of those rules only avoid
  offering something that would be refused.
- **Prompt versioning.** One system prompt, append-only, and every session
  records the version it ran on — so "which prompt produced this feedback?" stays
  answerable after the prompt has moved on. No console edits it: the prompt is
  set through the API, not from a screen a teacher can reach.

## Layout

```
shared/          definitions both sides need: roles, activity shapes, marking
                 ids and shapes only — never a display word, in any language
server/          the API — see server/README.md
  routes/          HTTP surface
  services/        the rules, in one place each
  store/           memory + mongo, identical interfaces
  lib/storage.js   uploads: local disk or DigitalOcean Spaces
  lib/openai.js    the tutor's model, over plain fetch
src/
  routes/          one folder per audience: student, teacher, admin
  components/      the workspace panels, plus the shared chrome
  lib/             api client, auth context, i18n, helpers
  lib/strings.js   every interface string, English and Turkish side by side
```

## Deploying

Vercel runs Express natively, so the whole API is one function. The `.env` /
`.env.local` merge is development-only: a deployment reads neither file and is
configured entirely in Vercel → Project → Settings → Environment Variables. See
[Deploying to Vercel](server/README.md#deploying-to-vercel) for what has to be
set there.
