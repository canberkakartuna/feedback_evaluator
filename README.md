# Dropshot

A research workspace for studying how AI feedback helps students work through
problems. Teachers write the questions, students work through them talking to a
tutor, and the exchanges that come out get read, kept and labelled to build a
dataset.

React 19 + Vite on the front, Express 5 + MongoDB behind. The API has its own
documentation in [server/README.md](server/README.md); this file is the map.

```bash
npm install
cp .env.example .env          # then put MONGODB_URI in .env.local
npm run dev:api               # API on :4000
npm run dev                   # client on :5173, proxying /api
npm run test:api              # 280 end-to-end assertions over real HTTP
npm run check:strings         # every interface string, in both languages
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
| `/` | students | Consent, then anonymously or signed in, pick an activity |
| `/join`, `/join/:code` | students | The same, reached by a class code or its link |
| `/work/:sessionId` | students | The workspace: question, answer, tutor chat |
| `/teacher` | teachers, managers | Write activities, read student work, label snippets |
| `/admin` | administrators | Accounts, and the system-wide AI prompt |

Every screen carries the same bar of direct buttons — **home, sign in or sign
out, the console for whoever is signed in, and the language switch** — so the way
out of a screen is never a link buried in a paragraph. See
`src/components/TopBar.jsx`.

### Two ways in for a student

- **Anonymously** — no code, no password, nothing asked. Consent, then pick from
  the list of published activities. This is the normal way in and what the study
  is designed around.
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

### Who sees the consent notice, and how often

| Who | Sees it |
| --- | --- |
| Anonymous student | Every visit — there is no account to remember it against |
| Student with a password | **Once, ever.** Agreeing records it on the account (`POST /api/auth/consent`), and `user.consented` is what later visits read |
| Teacher, manager, admin | Never — see below |

Bumping `CONSENT_VERSION` asks everybody again, which is the point of having a
version: an agreement to last term's wording is not an agreement to this term's.

The gate itself lives in one place, `src/routes/student/StudentLayout.jsx`, which
wraps every entry screen — so it is shown on the way *into* the student side
rather than on the way into each screen, and a new entry screen inherits it.

A token that cannot be checked — the API down, a proxy 502 — is **not** treated as
"anonymous". That fallback would quietly show a signed-in teacher a form written
for a research subject, so the screen says it cannot tell who is asking and offers
a retry instead.

### Staff are not participants

A teacher, manager or admin opening the student side **never sees the consent
notice**, and is not asked to agree to it. The notice asks a research subject to
agree to their answers and conversations being kept for the study; a teacher
checking what their class will see is not one, and ticking it on their behalf
would put staff clicks and student consent in the same field.

Such a session is stamped `staffPreview` instead, with `consent.given: false` and
`waived: 'staff-preview'` — recorded honestly rather than fudged — and the roster
labels it so it cannot be read as a student's work. `routes/sessions.js` is where
that holds. A **student** with an account is not staff and is asked every time.

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
- **Who can see whom.** Roles and reach are enforced in `services/users.js` and
  `services/activities.js`. The client's copies of those rules only avoid
  offering something that would be refused.
- **Prompt versioning.** One system prompt, append-only, and every session
  records the version it ran on — so "which prompt produced this feedback?" stays
  answerable after the prompt has moved on.

## Layout

```
shared/          definitions both sides need: roles, activity shapes, marking
                 ids and shapes only — never a display word, in any language
server/          the API — see server/README.md
  routes/          HTTP surface
  services/        the rules, in one place each
  store/           memory + mongo, identical interfaces
  lib/storage.js   uploads: local disk or DigitalOcean Spaces
src/
  routes/          one folder per audience: student, teacher, admin
  components/      the workspace panels, plus the shared chrome
  lib/             api client, auth context, i18n, helpers
  lib/strings.js   every interface string, English and Turkish side by side
```

## Deploying

Vercel runs Express natively, so the whole API is one function. See
[Deploying to Vercel](server/README.md#deploying-to-vercel) for the environment
split — in particular which secrets belong in the host's settings rather than in
the committed `.env`.
