# Feedback Evaluator

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
npm run test:api              # 245 end-to-end assertions over real HTTP
```

## Three audiences, one deployment

| Route | Who | What they do |
| --- | --- | --- |
| `/` | students | Consent, then anonymously or signed in, pick an activity |
| `/work/:sessionId` | students | The workspace: question, answer, tutor chat |
| `/teacher` | teachers, managers | Write activities, read student work, label snippets |
| `/admin` | administrators | Accounts, and the system-wide AI prompt |

### Two ways in for a student

- **Anonymously** — no code, no password, nothing asked. Consent, then pick from
  the list of published activities. This is the normal way in and what the study
  is designed around.
- **Signed in**, with an email and password their teacher set for them. The list
  is narrowed to their own teacher's work, and the session carries their name so
  it can be followed across visits.

There is no join code. **Publishing is the whole access decision**: a draft is
invisible and cannot be started, a published activity is startable by whoever is
looking. Closing an activity again is how a teacher shuts it down.

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

**Most students never get an account.** They open the site, agree to the consent
notice, and type the code their teacher put on the board. The session is
anonymous, and the teacher still sees it, because it is attached to an activity
they own.

## How the pieces fit

```
activity ──< question          a teacher's set of questions; published or not
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

A **question** needs only a prompt. Two optional extras change what it can do:

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
server/          the API — see server/README.md
  routes/          HTTP surface
  services/        the rules, in one place each
  store/           memory + mongo, identical interfaces
src/
  routes/          one folder per audience: student, teacher, admin
  components/      the workspace panels
  lib/             api client, auth context, helpers
```

## Deploying

Vercel runs Express natively, so the whole API is one function. See
[Deploying to Vercel](server/README.md#deploying-to-vercel) for the environment
split — in particular which secrets belong in the host's settings rather than in
the committed `.env`.
