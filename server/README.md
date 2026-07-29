# API

Node 22 + Express 5. Storage is **in-memory** for now; see [Moving to MongoDB](#moving-to-mongodb).

```bash
npm run dev:api      # node --watch, port 4000
npm run test:api     # end-to-end check over real HTTP (75 assertions)
```

Vite proxies `/api` to port 4000, so the client calls `/api/...` with no base URL.

## Environment

| Variable | Default | Notes |
| --- | --- | --- |
| `PORT` | `4000` | |
| `ALLOWED_ORIGINS` | `http://localhost:5173,http://localhost:5174` | CORS allow-list |
| `UPLOAD_DIR` | `server/.uploads` | Photos and whiteboard exports |
| `MAX_UPLOAD_BYTES` | `10485760` | 10 MB per file |
| `RESEARCH_TOKEN` | *unset* | **Researcher endpoints return 503 until this is set.** No default on purpose — these read every student's transcript. |
| `CONSENT_VERSION` | `2026-07-29.placeholder` | Stored on each consent record |

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

## Moving to MongoDB

`store/memory.js` is already async and already grouped by collection —
`sessions`, `answers`, `messages`, `events`, `ownQuestions`, `uploads`,
`prompts`, `snippetLabels`. Add `store/mongo.js` with the same methods and
select it in `store/index.js` when `MONGODB_URI` is set. Nothing in `routes/`
or `services/` should change.

Indexes worth creating on day one:

```js
sessions:      { id: 1 }, { code: 1 }, { createdAt: -1 }
answers:       { sessionId: 1, questionId: 1 }   // unique
messages:      { sessionId: 1, questionId: 1, seq: 1 }, { id: 1 }
events:        { sessionId: 1, at: 1 }, { type: 1 }
ownQuestions:  { sessionId: 1 }
uploads:       { id: 1 }, { sessionId: 1 }
snippetLabels: { snippetId: 1 }                  // unique
```

Two things `memory.js` fakes that Mongo must do properly:

- **`messages.seq`** is a process-local counter. Use a per-session counter
  document, or sort by `createdAt` with `_id` as the tie-break.
- **Documents are cloned on read.** The driver gives you fresh objects anyway,
  so the `clone()` calls can go.

Uploads currently land on local disk. GridFS or object storage is the next step
if more than one instance ever runs.
