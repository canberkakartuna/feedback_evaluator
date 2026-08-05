import express from 'express'
import { config } from '../config.js'
import { isStaff } from '../../shared/roles.js'
import { cleanNickname } from '../../shared/session.js'
import { hasCurrentConsent } from '../services/users.js'
import { removeBytes } from './uploads.js'
import { activityQuestions, publicActivity } from '../services/delivery.js'
import { badRequest, id, notFound, now, route, shortCode } from '../lib/http.js'

export function sessionRoutes(store) {
  const router = express.Router()

  /**
   * Which activity this session is for.
   *
   * Two ways in, and they are the same decision reached from two directions:
   *
   *   activityId  clicked from the list at `GET /api/activities/available`
   *   code        the class code, typed at /join or followed as a link
   *
   * Neither is a credential. **Publishing is the whole access decision** — a
   * draft is refused down both paths, so a code opens exactly what the list
   * already offered and nothing more. The code exists to save a class from
   * reading twenty titles, not to gate anything.
   *
   * A draft is reported as "not open yet" rather than "no such activity",
   * because the only way to be holding an id or a code at all is to have been
   * shown it. The interesting case is a teacher unpublishing between the list
   * and the click, and that student is entitled to know it was withdrawn rather
   * than that it never existed. An unknown *code* is a 404, though: mistyping
   * six characters off a projector is the ordinary way to get one wrong.
   */
  async function resolveActivity(body) {
    const code = typeof body?.code === 'string' ? body.code.trim() : ''
    const activityId = typeof body?.activityId === 'string' ? body.activityId.trim() : ''

    if (!activityId && !code) {
      throw badRequest('"activityId" or "code" is required — choose an activity to start')
    }

    const activity = activityId
      ? await store.activities.findById(activityId)
      : await store.activities.findByCode(code)

    if (!activity) throw notFound(code ? 'No activity has that class code' : 'No such activity')
    if (activity.status !== 'published') throw badRequest('That activity is not open yet')

    return activity
  }

  /**
   * Starting a session IS the consent record. There is no route that creates a
   * session without it, so the gate cannot be bypassed by calling the API
   * directly — which is the only place a gate actually holds.
   *
   * **Staff are exempt, and that is the point of the exemption.** The notice
   * asks a research participant to agree to their answers and conversations
   * being kept for the study. A teacher opening their own activity to see what
   * their class will see is not a participant, so asking them to agree makes the
   * consent record meaningless: it would then contain a mix of subjects who
   * consented and staff who clicked past a form addressed to somebody else. Such
   * a session is stamped `staffPreview` instead, which is what lets the roster
   * and the export tell a walkthrough apart from a student's work.
   *
   * A student with an account is *not* staff, and is asked — but **once**, not
   * every time. Their agreement is recorded on the account by
   * `POST /api/auth/consent`, and a session started later carries that consent
   * forward with the date it was first given rather than pretending it was given
   * just now. An anonymous student has no account to remember it against, so
   * they are asked every visit; that is a property of being anonymous, not a
   * different rule.
   */
  router.post(
    '/',
    route(async (req, res) => {
      const staff = isStaff(req.user?.role)
      const onAccount = hasCurrentConsent(req.user)
      const consented = req.body?.consent === true || onAccount

      if (!staff && !consented) {
        throw badRequest('Consent is required to start a session', {
          field: 'consent',
          expected: true,
        })
      }

      const activity = await resolveActivity(req.body)
      const questions = await activityQuestions(store, activity.id)
      const active = await store.prompts.active()

      const session = await store.sessions.create({
        id: id('ses'),
        code: shortCode(),
        createdAt: now(),
        endedAt: null,
        activityId: activity.id,
        /**
         * Null unless the request carried a login token.
         *
         * The link is optional because anonymous work has to keep working — this
         * route is the consent record, and consent does not require an account.
         * When there is an account, the session attaches to it, and that is what
         * lets a teacher see their own students' work through
         * `GET /api/users/:userId/sessions`.
         */
        userId: req.user?.id ?? null,
        /**
         * `given: false` for a staff walkthrough, rather than a polite `true`
         * nobody actually said. A consent record that claims agreement it never
         * collected is the one field in this schema it would be worst to fudge.
         */
        consent: {
          given: consented,
          at: now(),
          version: config.consentVersion,
          /**
           * When they first agreed, for a student whose account carries it. The
           * `at` above is when *this session* started, and conflating the two
           * would put a date on an agreement that was given weeks earlier.
           */
          ...(onAccount ? { firstGivenAt: req.user.consent.at } : {}),
          ...(staff && !consented ? { waived: 'staff-preview' } : {}),
        },
        /** Flat and boolean, because every reader of it is a filter. */
        staffPreview: staff && !consented,
        /**
         * What to call this session on a teacher's roster.
         *
         * Only for work with no account behind it: a signed-in session is already
         * named by its user, and a nickname on top would be a second, editable
         * name for the same person. Null when they did not offer one, in which
         * case `code` above is still the handle it always was.
         *
         * Free text, so it is possible for a student to type their real name into
         * it despite being asked not to. That is a risk the consent notice names
         * explicitly rather than one this field can prevent — nothing here can
         * tell a made-up name from a real one.
         */
        nickname: req.user ? null : cleanNickname(req.body?.nickname),
        // Room for the study design: which model/prompt this session ran on.
        conditionId: req.body.conditionId ?? 'default',
        promptVersion: active?.versionId ?? null,
        device: typeof req.body.device === 'string' ? req.body.device.slice(0, 200) : null,
      })

      await store.events.insertMany([
        {
          id: id('evt'),
          sessionId: session.id,
          userId: session.userId,
          type: 'session_started',
          at: now(),
          payload: {
            activityId: activity.id,
            signedIn: Boolean(session.userId),
            // How they got here, which is worth knowing once there are two doors.
            via: req.body?.code ? 'code' : 'list',
            staffPreview: session.staffPreview,
          },
        },
      ])

      res.status(201).json({ session, activity: publicActivity(activity, questions) })
    }),
  )

  /**
   * Everything the client needs to rebuild its state.
   *
   * The activity is loaded through the session rather than passed in, so a
   * resumed session shows the questions it was started against even if the
   * teacher has since edited them — and it keeps working if the activity was
   * unpublished in the meantime, which resolveActivity would refuse.
   */
  async function sessionPayload(session) {
    const activity = session.activityId
      ? await store.activities.findById(session.activityId)
      : null

    return {
      session,
      activity: activity
        ? publicActivity(activity, await activityQuestions(store, activity.id))
        : null,
    }
  }

  router.get(
    '/:sessionId',
    route(async (req, res) => {
      const session = await store.sessions.findById(req.params.sessionId)
      if (!session) throw notFound('No such session')

      const [payload, answers, messages, own] = await Promise.all([
        sessionPayload(session),
        store.answers.listBySession(session.id),
        store.messages.listBySession(session.id),
        store.ownQuestions.listBySession(session.id),
      ])

      res.json({ ...payload, answers, messages, ownQuestions: own })
    }),
  )

  router.post(
    '/:sessionId/end',
    route(async (req, res) => {
      const session = await store.sessions.update(req.params.sessionId, { endedAt: now() })
      if (!session) throw notFound('No such session')
      await store.events.insertMany([
        { id: id('evt'), sessionId: session.id, type: 'session_ended', at: now(), payload: {} },
      ])
      res.json({ session })
    }),
  )

  /** "Delete my session" — the withdrawal half of consent. */
  router.delete(
    '/:sessionId',
    route(async (req, res) => {
      const session = await store.sessions.findById(req.params.sessionId)
      if (!session) throw notFound('No such session')

      const removedUploads = await store.uploads.removeBySession(session.id)
      await Promise.all([
        store.answers.removeBySession(session.id),
        store.messages.removeBySession(session.id),
        store.events.removeBySession(session.id),
        store.ownQuestions.removeBySession(session.id),
        store.sessions.remove(session.id),
      ])

      // Files too, or "delete" is a lie. Goes through the storage backend so it
      // reaches Spaces as well as disk — see removeBytes in routes/uploads.js.
      await Promise.all(removedUploads.map(removeBytes))

      res.json({ deleted: true, sessionId: session.id, files: removedUploads.length })
    }),
  )

  return router
}
