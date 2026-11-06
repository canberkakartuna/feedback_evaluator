import express from 'express'
import { requireAuth, requireRole } from '../lib/auth.js'
import { route } from '../lib/http.js'
import { translate } from '../services/translate.js'

/**
 * `POST /api/translate { text, from, to }` → `{ text, model }`.
 *
 * Authors only: it spends the same model quota the tutor does, and nothing a
 * student does needs it. See services/translate.js for why the result is a
 * draft the teacher saves, not something written here.
 */
export function translateRoutes() {
  const router = express.Router()

  router.post(
    '/',
    requireAuth,
    requireRole('teacher', 'manager', 'admin'),
    route(async (req, res) => {
      const { text, from, to } = req.body ?? {}
      res.json(await translate({ text, from, to }))
    }),
  )

  return router
}
