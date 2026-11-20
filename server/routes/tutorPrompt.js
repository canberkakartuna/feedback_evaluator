import express from 'express'
import { requireAuth, requireRole } from '../lib/auth.js'
import { route } from '../lib/http.js'
import { enhanceTutorPrompt } from '../services/tutorPrompt.js'

/**
 * `POST /api/tutor-prompt/enhance { text, lang? }` → `{ text, model }`.
 *
 * Authors only, like /api/translate: it spends the tutor's model quota, and
 * nothing a student does needs it. See services/tutorPrompt.js for why the
 * result is a suggestion the teacher accepts or discards, not something
 * written here.
 */
export function tutorPromptRoutes() {
  const router = express.Router()

  router.post(
    '/enhance',
    requireAuth,
    requireRole('teacher', 'manager', 'admin'),
    route(async (req, res) => {
      const { text, lang } = req.body ?? {}
      res.json(await enhanceTutorPrompt({ text, lang }))
    }),
  )

  return router
}
