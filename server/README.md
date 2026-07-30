# API

Node 22 + Express 5. Storage is **MongoDB when `MONGODB_URI` is set**, and
in-memory when it is not — see [The store](#the-store).

```bash
npm run dev:api          # node --watch, port 4000
npm run test:api         # end-to-end check over real HTTP, in-memory (76 assertions)
npm run test:api:mongo   # the same assertions against MongoDB (78)
```

`npm run test:api` ignores `MONGODB_URI` on purpose and runs in-memory: it counts
rows, so pointing it at a real database would both fail and litter it. The Mongo
run uses a throwaway database and drops it at the end.

Vite proxies `/api` to port 4000, so the client calls `/api/...` with no base URL.

## Environment

Two files at the repo root, read in development and in the deployment alike.
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

- **`.env` is committed**, because that is the only way a serverless deployment
  reads it. Everything in it is visible to anyone with repository access and
  stays in git history, permanently. `RESEARCH_TOKEN` lives here and is rotated
  by editing the value. **No credentials.**
- **`.env.local` is gitignored** (by the `*.local` rule) and overrides `.env`.
  This is where `MONGODB_URI` goes when working locally.
- **In a deployment, credentials come from the host's own environment settings**
  (Vercel: Project → Settings → Environment Variables), which beat both files.
  `.env.local` is not committed, so it is not deployed — that is the point.
- **`vercel.json` names `.env` under `includeFiles`.** Without that the file is
  not traced into the function bundle and none of this loads once deployed.

Vite applies the same two files in the same order to `VITE_`-prefixed keys, so
the client and the API never disagree about which value won.

| Variable | Default | Notes |
| --- | --- | --- |
| `PORT` | `4000` | |
| `ALLOWED_ORIGINS` | `http://localhost:5173,http://localhost:5174` | CORS allow-list. The deployment is same-origin and needs no entry. |
| `UPLOAD_DIR` | `server/.uploads`, or the temp dir when serverless | Photos and whiteboard exports |
| `MAX_UPLOAD_BYTES` | `10485760` | 10 MB per file |
| `RESEARCH_TOKEN` | *unset* | **Researcher endpoints return 503 until this is set.** No default on purpose — these read every student's transcript. |
| `CONSENT_VERSION` | `2026-07-29.placeholder` | Stored on each consent record. Bump it when the consent wording changes. |
| `VITE_API_BASE` | empty | Client-side. Empty means same-origin `/api`. |
| `MONGODB_URI` | *unset* | **A credential — `.env.local` or the host, never `.env`.** Set means the MongoDB store, unset means in-memory. |
| `MONGODB_DB` | `feedback_evaluator` | Just a name, so `.env` is fine. Atlas's copy-paste URI names no database and the driver would silently use `test`. |

## What the server owns, and why

- **Consent.** There is no route that creates a session without `consent: true`. The UI gate is a courtesy; this is the gate.
- **The mark scheme.** `GET /api/course` never returns rubric keywords or tutor scripts. Marking runs in `POST .../check`. Previously a student could read every answer out of the JS bundle.
- **Hint escalation.** The server counts hints and holds their text, so hint 3 is not readable before hint 1 is asked for.
- **One answer per question.** Changing `mode` clears what the previous mode held, so a stored answer is never two answers.

## Student endpoints

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/health` | |
| `GET` | `/api/course?topicId=` | Sanitised. `topicId` defaults to `all` |
| `GET` | `/api/sessions/topics` | For the entry screen |
| `POST` | `/api/sessions` | `{ consent: true, topicId?, device?, conditionId? }` → `{ session, course }`. **400 without consent** |
| `GET` | `/api/sessions/:id` | Resume: session, course, answers, messages, own questions |
| `GET` | `/api/sessions/by-code/:code` | Attach a phone to a session (doc item 3) |
| `POST` | `/api/sessions/:id/end` | |
| `DELETE` | `/api/sessions/:id` | "Delete my session" — also deletes the files |
| `PUT` | `/api/sessions/:id/answers/:questionId` | `{ mode?, draft?, strokes?, selfMark? }` |
| `GET` | `/api/sessions/:id/answers/:questionId` | |
| `POST` | `/api/sessions/:id/answers/:questionId/check` | Marks against the hidden rubric |
| `GET` | `/api/sessions/:id/questions/:qid/messages` | Thread for one question |
| `POST` | `/api/sessions/:id/questions/:qid/messages` | `{ text }` **or** `{ action: hint\|concept\|example\|review }` → `{ student, tutor }` |
| `POST` | `/api/sessions/:id/messages/:msgId/rating` | `{ value: up\|down, note? }` (doc item 5) |
| `POST` | `/api/sessions/:id/questions/:qid/uploads` | `{ name, dataUrl, source: file\|whiteboard }` |
| `DELETE` | `/api/sessions/:id/questions/:qid/uploads/:uploadId` | |
| `GET` | `/api/uploads/:uploadId` | Serves the bytes |
| `POST` | `/api/sessions/:id/own-questions` | `{ prompt }` (doc item 8) |
| `GET` | `/api/sessions/:id/own-questions` | |
| `POST` | `/api/sessions/:id/events` | `{ events: [{ type, questionId?, payload?, at? }] }`, max 200 |
| `GET`/`POST` | `/api/prompts` | Versioned system prompt (doc item 6) |

## Researcher endpoints

`Authorization: Bearer $RESEARCH_TOKEN` (or `X-Research-Token`).

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/research/sessions` | Every session with message/snippet/event counts |
| `GET` | `/api/research/sessions/:id/transcript` | Grouped by question, with answers and events |
| `GET` | `/api/research/snippets?sessionId=&included=true\|false\|undecided` | **Snippets** = one student turn + the feedback that answered it |
| `PATCH` | `/api/research/snippets/:id` | `{ included, labels: { criterionId: yes\|no\|partly }, note, labelledBy }` |
| `GET` | `/api/research/export?format=json\|csv` | Kept snippets only; CSV is one row per snippet |

Snippets are **derived** from transcripts, not stored, so they stay correct as a
thread grows. Only the decision about each one is persisted.

## Events

The client should batch these. The useful measures are differences between
timestamps, not states worth a request each.

`session_started` · `session_ended` · `question_shown` · `answer_saved` ·
`answer_checked` · `student_marked_question` · `student_message_sent` ·
`student_requested_help` · `ai_feedback_shown` · `student_rated_feedback` ·
`student_uploaded_image` · `student_added_own_question`

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

Set `RESEARCH_TOKEN` and `MONGODB_URI` in project settings — not in `.env`; see
[Environment](#environment).

### One thing still assumes a single long-lived process

`GET /api/health` reports `ready: false` until every warning it lists is gone.
The store was one of them and no longer is. What remains:

**Uploads go to a disk that does not persist.** Only the temp directory is
writable, it is per-instance, and it is cleared. `config.uploadDir` points there
automatically when `VERCEL` is set so nothing crashes, but a photo uploaded on
one request may be gone on the next. Replace the `fs` calls in
`routes/uploads.js` with Vercel Blob (`npm i @vercel/blob`, private store) or
GridFS, and keep serving bytes through `/api/uploads/:id` so the client contract
does not change.

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
`ownQuestions`, `uploads`, `prompts`, `snippetLabels` — so nothing in `routes/`
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

Indexes are created on first connect, and are idempotent:

```js
sessions:      { code: 1 }, { createdAt: -1 }
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
