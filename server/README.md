# API

Node 22 + Express 5. Storage is **MongoDB when `MONGODB_URI` is set**, and
in-memory when it is not — see [The store](#the-store).

```bash
npm run dev:api          # node --watch, port 4000
npm run test:api         # end-to-end check over real HTTP, in-memory (311 assertions)
npm run test:api:mongo   # the same assertions against MongoDB (313)
```

`npm run test:api` ignores `MONGODB_URI` on purpose and runs in-memory: it counts
rows, so pointing it at a real database would both fail and litter it. The Mongo
run uses a throwaway database and drops it at the end.

Vite proxies `/api` to port 4000, so the client calls `/api/...` with no base URL.

## Environment

Two files at the repo root, merged **in development only** — a deployment reads
neither and is configured entirely in the host's environment settings.
`.env.example` is the template:

```bash
cp .env.example .env
node -e "console.log(require('node:crypto').randomBytes(24).toString('base64url'))"  # a token
```

**Precedence is: real environment variables, then `.env.local`, then `.env`.**
The first setter of a key wins, so a host-injected value overrides both files
with no code change — and the smoke test can set its own values before importing
`config.js`.

The split is the important part:

- **`.env` is committed** — the shared development defaults and knobs.
  Everything in it is visible to anyone with repository access and stays in git
  history, permanently. **No credentials.**
- **`.env.local` is gitignored** (by the `*.local` rule) and overrides `.env`.
  This is where credentials — `OPENAI_API_KEY`, `MONGODB_URI` — go when working
  locally.
- **A deployment reads neither file.** `server/config.js` skips both when
  `VERCEL` is set, so in production every value — credentials and knobs alike —
  comes from the host's own environment settings (Vercel: Project → Settings →
  Environment Variables). Set everything the deployment needs there before
  deploying.

Vite applies the same two files in the same order to `VITE_`-prefixed keys, so
the client and the API never disagree about which value won.

| Variable | Default | Notes |
| --- | --- | --- |
| `PORT` | `4000` | |
| `ALLOWED_ORIGINS` | `http://localhost:5173,http://localhost:5174` | CORS allow-list. The deployment is same-origin and needs no entry. |
| `UPLOAD_DIR` | `server/.uploads`, or the temp dir when serverless | Photos and whiteboard exports |
| `MAX_UPLOAD_BYTES` | `10485760` | 10 MB per file |
| `RESEARCH_TOKEN` | *unset* | **Researcher endpoints return 503 until this is set.** No default on purpose — these read every student's transcript. |
| `AUTH_TOKEN_TTL_DAYS` | `30` | How long a login lasts. |
| `BOOTSTRAP_TOKEN` | falls back to `RESEARCH_TOKEN` | Guards `POST /api/auth/bootstrap`. **Set one of the two before deploying** — with neither, whoever calls that route first on an empty database becomes the admin. |
| `CONSENT_VERSION` | `2026-07-29.placeholder` | Stored on each consent record. Bump it when the consent wording changes. |
| `OPENAI_API_KEY` | *unset* | **A credential. Kept in `.env.local`, which means the deployment needs it set in the host's settings** — `.env.local` is not deployed, so without that the deployed tutor answers scripted and nothing on screen says so. Unset anywhere means the scripted lines in `shared/tutor-scripts.js` and no model; `/api/health` warns while that is so. [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |
| `OPENAI_MODEL` | `gpt-5-mini` | A reasoning model — markedly better tutoring than the old `gpt-4o-mini` default, and it reads uploaded question images well. `config.js` derives the family-dependent knobs (temperature, reasoning effort) from the name, so switching model alone is safe. The bare name is an alias that moves to the newest snapshot; pin a dated one while a study is running so replies stay comparable. |
| `OPENAI_MAX_OUTPUT_TOKENS` | `4000` | **Not the reply length** — the prompt caps that at 120 words. On a reasoning model the hidden reasoning is billed to this allowance and spent first, so a tight number truncates the answer rather than saving money. |
| `OPENAI_REASONING_EFFORT` | `low` on a reasoning model, omitted otherwise | `minimal`/`low`/`medium`/`high`, sent as `reasoning_effort`. Reasoning models (o-series, gpt-5-\*) only — the others reject it with a 400, so `config.js` omits it for them by default. |
| `OPENAI_TIMEOUT_MS` | `20000` | A student is watching a typing indicator. |
| `OPENAI_TEMPERATURE` | omitted on a reasoning model, `0.6` otherwise | Empty sends nothing, which is what a reasoning model requires; `config.js` picks the right default for the model family. |
| `VITE_API_BASE` | empty | Client-side. Empty means same-origin `/api`. |
| `MONGODB_URI` | *unset* | **A credential — `.env.local` or the host, never `.env`.** Set means the MongoDB store, unset means in-memory. |
| `MONGODB_DB` | `dropshot` | Just a name, so `.env` is fine. Atlas's copy-paste URI names no database and the driver would silently use `test`. |
| `SPACES_KEY` / `SPACES_SECRET` | *unset* | **A credential — `.env.local` or the host, never `.env`.** Both set means the Spaces backend; either missing means local disk. |
| `SPACES_BUCKET` | `dropshot` | Just a name. |
| `SPACES_REGION` | `sfo3` | Used for request signing; the endpoint does the routing. |
| `SPACES_ENDPOINT` | `https://$SPACES_REGION.digitaloceanspaces.com` | |
| `SPACES_URL_TTL` | `300` | Seconds a signed read URL stays valid. |

## What the server owns, and why

- **Consent.** There is no route that creates a session without `consent: true` — with one deliberate exception: **staff** (teacher, manager, admin) are not asked, because the notice is addressed to a research participant and they are not one. Their session is stamped `staffPreview: true` with `consent.given: false` and `waived: 'staff-preview'`, rather than claiming an agreement nobody gave. The UI gate is a courtesy; this is the gate.
- **The questions themselves.** Teachers author them; nothing is hard-coded. A student reaches an activity by picking it from `GET /api/activities/available`, or by its **class code** through `GET /api/activities/code/:code` — and both refuse a draft, so **publishing is the whole access decision** and the code is a shortcut, not a credential. See [Activity endpoints](#activity-endpoints).
- **The mark scheme.** No student-facing route returns rubric keywords, tutor scripts or the teacher's answer; `shared/activity.js` `publicQuestion` is the one place that decides what travels. Marking runs in `POST .../check`. Previously a student could read every answer out of the JS bundle.
- **Hint escalation.** The server counts hints and holds their text, so hint 3 is not readable before hint 1 is asked for. True whether the hint was authored or generated: the model is asked for hint *n* and told nothing about hint *n + 1*.
- **The model call.** The API key, the system prompt and the request are all server-side — see [The tutor](#the-tutor). The browser sends what the student typed and receives one reply.
- **One answer per question.** Changing `mode` clears what the previous mode held, so a stored answer is never two answers.
- **Who can see whom.** Roles and the hierarchy are enforced in `services/users.js`, not in the client. See [Users, roles and the hierarchy](#users-roles-and-the-hierarchy).

## Users, roles and the hierarchy

Four roles, and one edge type between them. `shared/roles.js` is where the shape
is written down; `services/users.js` is where it is enforced.

```
admin  ─ sees and does everything, including /api/research/*
  │
manager ─ has many teachers, and through them their students
  │
teacher ─ has many students
  │
student ─ sees only themselves
```

**The hierarchy is a pointer from child to parent.** A student holds `teacherId`,
a teacher holds `managerId`. One source of truth per edge, so moving a student
between teachers is a single write — no roster array to keep in step, and no way
to end up on two of them because the second write failed.

| Role | Can create | Can see |
| --- | --- | --- |
| `admin` | anyone | everyone |
| `manager` | teachers, and students under their own teachers | self + their teachers + those teachers' students |
| `teacher` | students, on their own roster | self + their own students |
| `student` | nobody | self |

Rules worth knowing before building against this:

- **Out of scope reads as 404, not 403.** That an id exists at all is not
  something one teacher should learn from another's roster.
- **A query cannot widen scope.** `GET /api/users?teacherId=` filters *within*
  what the caller can already see, so pointing it at someone else's roster
  returns nothing rather than leaking it.
- **A teacher creating a student may omit `teacherId`** — themselves is the only
  answer available to them. An admin may leave it `null`, meaning "on nobody's
  roster yet".
- **Nobody administers themselves.** `name` and `email` are yours to change;
  `active`, `role` and the parent pointer need authority over the target, and the
  last active admin cannot demote themselves out of the system.
- **Deactivate, don't delete.** `PATCH { active: false }` revokes every live
  token immediately and keeps the person's work attributable. `DELETE` is refused
  when they still have people under them, when they have recorded work sessions,
  or when they are the caller — deleting a student is not consent withdrawal, and
  `DELETE /api/sessions/:id` is.

### Authentication

Email and password. The password is hashed with `node:crypto`'s **scrypt** —
memory-hard, no dependency — and the stored string carries its own parameters
(`scrypt$16384$8$1$salt$key`), so raising the cost later does not lock anyone out.

Login returns an opaque bearer token. **The database stores only its SHA-256**,
so a stolen dump grants nobody a session. Plain SHA-256 is right here and scrypt
would not be: the token is 32 random bytes, so there is no low-entropy secret to
slow an attacker down over.

Authentication is **optional at the door and required at the route**
(`lib/auth.js`). Most of this API is anonymous by design — a student can consent
and work through a session without an account, and that keeps working. This is
also why the researcher endpoints are unaffected: they send their own token on
the same `Authorization` header, it matches no user, `req.user` stays null, and
their own check runs.

### The first admin

Every user is created by someone who already has an account, which leaves one
hole: the empty database. `POST /api/auth/bootstrap` fills it, and is closed by
two conditions — **no user exists**, and **the bootstrap token matches** when one
is configured. Once any user exists the route is permanently shut.

```bash
curl -X POST localhost:4000/api/auth/bootstrap \
  -H "authorization: Bearer $RESEARCH_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"name":"Root","email":"root@example.com","password":"a long passphrase"}'
```

### Auth endpoints

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/api/auth/bootstrap` | The first admin. Needs the bootstrap token; refused once any user exists |
| `POST` | `/api/auth/login` | `{ email, password }` → `{ user, token, expiresAt }`. A wrong password and an unknown address answer identically, and take the same time to |
| `POST` | `/api/auth/consent` | No body. Records the research consent against the caller's own account and returns the updated user. Idempotent: a repeat on a still-current version answers `recorded: false` and keeps the original date. This is what lets a student with a password be asked **once** instead of every visit |
| `GET` | `/api/auth/me` | The signed-in user |
| `POST` | `/api/auth/logout` | Revokes the calling token. Other devices stay signed in |
| `POST` | `/api/auth/password` | `{ currentPassword, newPassword }`. Revokes every other token and returns a fresh one |

### User endpoints

All require `Authorization: Bearer <login token>`.

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/api/users` | `{ role, name, email, password, teacherId?/managerId? }` → 201. 409 on a duplicate email |
| `GET` | `/api/users` | Everyone in scope. `?role=&teacherId=&managerId=&active=` narrow it |
| `GET` | `/api/users/:userId` | 404 when out of scope |
| `PATCH` | `/api/users/:userId` | `{ name?, email?, active?, role?, teacherId?/managerId? }`. `role` is admin-only |
| `POST` | `/api/users/:userId/password` | `{ newPassword }` — a reset for someone you administer. Revokes their sessions |
| `DELETE` | `/api/users/:userId` | Refused with 409 when it would orphan a roster or destroy recorded work |
| `GET` | `/api/users/:userId/sessions` | A student's work sessions with counts — how a teacher checks on their own students without the researcher token |

### Activity endpoints

Authoring requires a login token and a role of teacher, manager or admin. Reach
is by ownership: a teacher sees their own activities, a manager sees theirs plus
every teacher on their roster, an admin sees all. Out of reach answers 404, not
403 — whether an activity id exists is not something one teacher should learn
from another's list.

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/activities` | Everything in scope, each with a `questionCount` |
| `POST` | `/api/activities` | `{ title, blurb? }` → 201. Created as a **draft**, invisible to students until published |
| `GET` | `/api/activities/:id` | The authoring view: full questions, **mark scheme and hints included** |
| `GET` | `/api/activities/:id/preview` | The same activity exactly as a student receives it |
| `PATCH` | `/api/activities/:id` | `{ title?, blurb?, status? }`. Publishing an activity with no questions is a 400 |
| `DELETE` | `/api/activities/:id` | 409 once any student has worked on it — unpublish instead |
| `POST` | `/api/activities/:id/questions` | `{ prompt?, image?, answer?, kind?, workingExpected?, stimulus?, rubric?, tutor? }`. **A prompt or an image — at least one** |
| `PATCH` | `/api/activities/:id/questions/:qid` | Same fields, all optional |
| `DELETE` | `/api/activities/:id/questions/:qid` | 409 once students have seen it |
| `POST` | `/api/activities/:id/questions/reorder` | `{ questionIds: […] }` — every id, exactly once |
| `GET` | `/api/activities/available` | **Open — no token needed.** Published activities: every one of them for an anonymous visitor, narrowed to their own teacher's for a signed-in student. Titles, topics and counts only, never the questions |
| `GET` | `/api/activities/code/:code` | **Open — no token needed.** One activity by its class code, case-insensitive. Same summary shape as `/available`. **404** on an unknown code, **400** on a draft ("not open yet") |

**Every activity carries a class code and a topic.** The code is six characters
from the unambiguous alphabet in `lib/http.js`, allocated at creation, unique
(checked on insert, and a unique sparse index in `store/mongo.js`), and
backfilled onto older activities the first time they are read. It exists so a
class can be pointed at one activity — read out, or followed as
`/join/ABC234` — and it opens nothing that publishing has not already opened.
The topic is one of `TOPICS` in `shared/activity.js`, or `null`; both lists in
the client filter on it.

**The rubric and the tutor script are optional, and that is the design.** A
question with only a prompt still works: the chat answers from the system
prompt and the answer is passed on unmarked rather than scored against criteria
nobody wrote. Fill them in and the same question gains per-criterion marking and
staged hints. `shared/activity.js` holds the helpers every reader uses so that
"no rubric" means one thing everywhere.

**So is the teacher's answer** — `answer`, a plain string. It is what a correct
response actually says, written by the teacher so the tutor guides toward *their*
answer rather than the model's own idea of one. It travels to the model with the
rubric and under the same rule (context, never recited — see [The tutor](#the-tutor)),
and like the rubric keywords it appears in no student-facing payload.

## Student endpoints

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/health` | |
| `POST` | `/api/sessions` | `{ consent: true, activityId, nickname? }` or `{ consent: true, code, nickname? }` → `{ session, activity }`. **400 without consent**, unless the token belongs to staff — then the session is a `staffPreview` and records no agreement. Send a login token and the session attaches to that user; without one `userId` is `null` and the session is anonymous. `nickname` labels an anonymous session on the teacher's roster — trimmed, capped at 40, `null` when blank, and ignored entirely when a token is sent, since an account already names it |
| `GET` | `/api/sessions/:id` | Resume: session, activity, answers, messages, own questions |
| `POST` | `/api/sessions/:id/end` | |
| `DELETE` | `/api/sessions/:id` | "Delete my session" — also deletes the files |
| `PUT` | `/api/sessions/:id/answers/:questionId` | `{ mode?, draft?, strokes?, selfMark? }` |
| `GET` | `/api/sessions/:id/answers/:questionId` | |
| `POST` | `/api/sessions/:id/answers/:questionId/check` | Marks against the hidden rubric. **400 when the question has no rubric** |
| `GET` | `/api/sessions/:id/questions/:qid/messages` | Thread for one question |
| `POST` | `/api/sessions/:id/questions/:qid/messages` | `{ text, lang? }` **or** `{ action: hint\|concept\|example\|review, lang? }` → `{ student, tutor }`. `lang` is `en` or `tr` and is which language the reply is written in — see [The tutor](#the-tutor) |
| `POST` | `/api/sessions/:id/messages/:msgId/rating` | `{ value: up\|down, note? }` (doc item 5) |
| `POST` | `/api/sessions/:id/questions/:qid/uploads` | `{ name, dataUrl, source: file\|whiteboard }` |
| `DELETE` | `/api/sessions/:id/questions/:qid/uploads/:uploadId` | |
| `GET` | `/api/uploads/:uploadId` | Serves the bytes |
| `POST` | `/api/sessions/:id/own-questions` | `{ prompt }` (doc item 8) |
| `GET` | `/api/sessions/:id/own-questions` | |
| `POST` | `/api/sessions/:id/events` | `{ events: [{ type, questionId?, payload?, at? }] }`, max 200 |
| `GET` | `/api/prompts` | The active system prompt and its version history |
| `POST` | `/api/prompts` | `{ text, note? }` → a new version, made active. Teacher, manager or admin; stamped with who wrote it |

## The tutor

`services/tutor.js` decides who answers a turn, and `lib/openai.js` makes the
call — plain `fetch` against OpenAI's Chat Completions API, no SDK, because
the whole surface used is one POST with a bearer token.

**Three sources, and which one speaks is decided per turn.**

1. **The teacher.** An authored hint, concept or worked example is delivered
   exactly as written. The study is about the feedback students receive and a
   model paraphrasing a carefully staged hint would replace it silently. The
   escalation is still the server's: it holds the text and hands out one step.
2. **The model.** Free text, "check my reasoning", and every turn on a question
   nobody wrote that field for — all of a student's own questions, and any tutor
   field a teacher left blank. It receives the system prompt, the question, the
   rubric's **criteria and coaching notes but never its keywords**, the teacher's
   answer when one was written (with a standing instruction to steer toward it,
   never recite it), the question's uploaded image when there is one, the
   student's answer as it stands, the last ten turns of the thread, and the
   language to reply in.
3. **The scripted lines** in `shared/tutor-scripts.js`, when there is no key or
   the call failed. Not a placeholder any more — a student who pressed send is
   owed a sentence, and this is the one they get. `GET /api/health` reports
   `tutor: "openai" | "scripted"` and warns while no model is running.

Every reply records `source` and `model`, on the message and on the snippet:
`openai`, `scripted` (a teacher's own words, or the generic script where no model
runs at all) or **`fallback`** — the model was asked and failed. That third value
is the one to watch. Nothing in the interface shows a failed call, so without it a
rate-limited lesson and a well-authored one look identical in the data. The
`ai_feedback_shown` event carries the reason alongside it.

**A reply runs on the prompt version its session was stamped with**, not on
whatever is active now — `store.prompts.byVersion`. Publishing v3 mid-lesson must
not quietly change what v2's sessions are answering with while the transcript
still says v2.

**Two things about the API worth knowing before touching the knobs**, both
documented at the top of `lib/openai.js`: on reasoning models the hidden
reasoning tokens are billed to `max_completion_tokens` and spent *first*, so a
tight allowance truncates the reply rather than saving money; and the knobs are
not accepted uniformly — reasoning models reject `temperature` and take
`reasoning_effort`, non-reasoning models the reverse, and the wrong one is a
flat 400.

**Rate limits are the thing to check before a class uses this.** The free tier
allows a handful of requests a minute and a daily token cap across the whole
key, which one classroom exceeds immediately; a 429 is not retried (the quota
does not clear in milliseconds) and every student over the limit silently gets
a scripted line instead. Add billing to the OpenAI account before a real
session, and read the `source` field afterwards to see what actually happened.

**The question's own image travels to the model.** A question uploaded as a
picture (JPG, PNG or WebP) is attached to the conversation — via a short-lived
signed URL from Spaces, or inlined from disk — so the tutor has actually read
the question it is tutoring. HEIC and PDF are formats the vision API refuses;
for those the instruction says honestly that the question is a file it cannot
view and must ask the student to read out. Before this, a photographed question
produced a tutor that had never seen the question at all.

Not sent to the model yet: whiteboard strokes and photographs of the student's
*working*. The model reads images and the bytes are in Spaces, so this is a
fetch-and-attach away — until then the honest scripted line ("I cannot read a
drawing or a photo yet") stands in, and `services/tutor.js` says so where it
decides.

## Reading and labelling

Two different callers use these, and they see different amounts.

A **researcher** presents `Authorization: Bearer $RESEARCH_TOKEN` (or
`X-Research-Token`), and a signed-in **admin** needs neither — they reach
everything already. Both see every session in the system.

A **teacher or manager** sees only what came out of their own work: sessions
belonging to students on their roster, *plus* anonymous sessions on activities
they own. That second half matters, because most sessions are anonymous and
would otherwise be invisible to the teacher who set the work. The scope is
computed per request from the same hierarchy `services/users.js` uses, and is
applied to writes as well as reads — a teacher cannot label a snippet out of
another teacher's class any more than they can read one.

| Method | Path | Who | Notes |
| --- | --- | --- | --- |
| `GET` | `/api/research/sessions` | scoped | Sessions with message/snippet/event counts |
| `GET` | `/api/research/sessions/:id/transcript` | scoped | Grouped by question, with answers and events |
| `GET` | `/api/research/snippets?sessionId=&included=true\|false\|undecided` | scoped | **Snippets** = one student turn + the feedback that answered it |
| `PATCH` | `/api/research/snippets/:id` | scoped | `{ included, labels: { criterionId: yes\|no\|partly }, note }` |
| `GET` | `/api/research/export?format=json\|csv` | **researcher only** | Kept snippets across every class; CSV is one row per snippet |

Snippets are **derived** from transcripts, not stored, so they stay correct as a
thread grows. Only the decision about each one is persisted.

`labelledBy` is taken from the login token, not the request body. The study wants
two coders per snippet so an inter-rater score can be computed, and that number
means nothing if the coder's name is self-reported. A researcher on the shared
token has no account, so they may still name themselves.

## Events

The client should batch these. The useful measures are differences between
timestamps, not states worth a request each.

`session_started` · `session_ended` · `question_shown` · `answer_saved` ·
`answer_checked` · `student_marked_question` · `student_message_sent` ·
`student_requested_help` · `ai_feedback_shown` · `student_rated_feedback` ·
`student_uploaded_image` · `student_added_own_question` · `user_signed_in` ·
`user_created`

The last two are account events rather than session telemetry, so they carry
`userId` and a `sessionId` of `null`.

Server time is authoritative; a client-supplied `at` is kept as `clientAt`.

## Deploying to Vercel

Vercel runs Express natively on the Node.js runtime, so the whole API is one
function. `api/[...path].js` default-exports the app; the catch-all filename
means every `/api/*` request arrives with its original URL, so Express routes
normally and no rewrite is needed. `vercel.json` sets the Vite build and caps
the function at 60s.

```bash
vercel            # preview
vercel --prod
```

The deployment reads no `.env` file at all, so set **everything it needs** in
project settings (Vercel → Project → Settings → Environment Variables) — at
minimum `RESEARCH_TOKEN`, `MONGODB_URI`, `MONGODB_DB`,
`SPACES_KEY`/`SPACES_SECRET`, `OPENAI_API_KEY` and `CONSENT_VERSION`; see
[Environment](#environment). Then create the first admin with
`POST /api/auth/bootstrap`; `GET /api/health` reports `ready: false` while no user
exists.

The function is capped at 60s and a tutor turn takes a few seconds, so nothing
here needs a longer budget — but `OPENAI_TIMEOUT_MS` has to stay well under that
cap, or a slow model becomes a platform timeout with no reply and no fallback.

### One thing still assumes a single long-lived process

`GET /api/health` reports `ready: false` until every warning it lists is gone.
The store was one of them and no longer is. What remains:

**Uploads need object storage, and now have it.** `lib/storage.js` has two
backends behind one interface, the same shape as the store: set `SPACES_KEY` and
`SPACES_SECRET` and files go to DigitalOcean Spaces, leave them unset and they
go to local disk. Disk on a serverless host is data loss — the temp directory is
per-instance and cleared — so `/api/health` warns while that combination is
live. `npm run setup:spaces` creates the bucket and proves a round trip works.

**Objects are private.** These are photographs of student work collected under a
consent notice, so the bucket is created private, every object is written
`ACL: private`, and `GET /api/uploads/:id` mints a short-lived signed URL and
redirects rather than proxying the bytes through the function. The setup script
fetches an object *without* a signature and fails if it comes back 200.

**`POST /api/auth/login` is not rate-limited.** scrypt makes each attempt cost
about 60 ms of CPU, which is a brake on guessing but not a lock. Nothing here
counts failures, and a per-instance counter would not be one on a serverless host
where the next attempt may land elsewhere — it needs shared state (a
`loginAttempts` collection keyed by email and IP, or Vercel Firewall rate-limiting
on the path). Worth doing before this is open to the internet with real accounts
in it.

Sessions themselves now survive. The failure this section used to describe —

```
session created on instance A : ses_86f5094e629e49089487
  read back from instance A   : 200 found
  read back from instance B   : 404 NOT FOUND
```

— re-run against MongoDB in two separate processes:

```
created ses_36be25e02cd2439fa4c2 (code P4796G) in process 94330
  read back from process 94358 : 200 FOUND
  read by code P4796G          : 200 FOUND
```

## The store

`store/index.js` is the only place that knows which one is in use: MongoDB when
`MONGODB_URI` is set, in-memory when it is not. Both expose the same async
methods, collection for collection — `sessions`, `answers`, `messages`, `events`,
`ownQuestions`, `uploads`, `prompts`, `snippetLabels`, `users`, `authTokens`,
`activities`, `questions` — so nothing in `routes/`
or `services/` knows the difference. `npm run test:api:mongo` runs the whole
smoke suite against Mongo to keep that true.

**There is deliberately no fallback between them.** A connection that quietly
degraded to an in-memory store would hand out sessions that vanish, which is the
failure the database is here to prevent. If the URI is set and the database
cannot be reached, requests fail and `/api/health` says why.

Three things about `store/mongo.js` worth knowing before editing it:

- **`_id` is the document's own id** wherever there is a natural unique key —
  `sessions.id`, `messages.id`, `${sessionId}:${questionId}` for an answer.
  Uniqueness is then the primary key's job, so an upsert cannot race and no
  secondary index is needed to look one up. Every read projects `_id` away, so
  callers see exactly what `memory.js` returns.
- **Connecting is lazy**, so `createApp()` stays synchronous and one instance
  holds one pool. A failed handshake is not cached — a DNS blip at boot would
  otherwise poison a serverless instance for its whole life.
- **`sessions.code` is not a unique index.** `shortCode()` is random and the
  memory store lets a repeat overwrite the older entry rather than fail; a unique
  index would turn a one-in-a-billion collision into a 500. Both stores answer
  `findByCode` with the newest match instead.

`users.email` is the exception to that last point, and deliberately **is**
unique: a duplicate address is a real error, not a coincidence, and a
check-then-insert in a handler is two round trips with a gap two simultaneous
sign-ups would both pass. `users.create` turns the driver's 11000 into a
`DuplicateEmailError`, the memory store raises the same thing from its own email
index, and `routes/users.js` reports either as a 409.

`authTokens` has no TTL index. `expiresAt` is an ISO string like every other
timestamp here and a Mongo TTL index needs a BSON date; expiry is checked on use
and an expired token deletes itself then, so what is left behind is only tokens
nobody presented again.

Indexes are created on first connect, and are idempotent:

```js
users:         { email: 1 } UNIQUE, { role: 1, name: 1 }, { teacherId: 1 }, { managerId: 1 }
authTokens:    { userId: 1 }
sessions:      { code: 1 }, { createdAt: -1 }, { userId: 1, createdAt: -1 }
answers:       { sessionId: 1 }
messages:      { sessionId: 1, questionId: 1, seq: 1 }, { sessionId: 1, seq: 1 }
events:        { sessionId: 1, at: 1 }, { type: 1 }
ownQuestions:  { sessionId: 1, createdAt: 1 }
uploads:       { sessionId: 1 }
prompts:       { active: 1, _id: -1 }
```

### Ordering, and why `seq` moved

`messages.seq` used to be a module-level counter in `routes/tutor.js`, which two
instances would have handed out twice over. It is now allocated by the store from
a per-session counter document (`counters`), and both numbers a request needs are
taken in one round trip — a snippet is built from a student turn and the reply
that answers it, so nothing may be numbered between them.

`seq` therefore orders *within* a session, not globally. `listAll()` sorts by
session, then question, then `seq`, and `buildSnippets` requires a pair to share
both — otherwise an ask at the end of one group would pair with the reply at the
start of the next. That was already reachable under concurrency with the global
counter; it is now impossible.

Uploads still land on local disk. GridFS or object storage is the remaining step.
