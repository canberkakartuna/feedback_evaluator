import { createApp } from '../server/app.js'

/**
 * Vercel entry point.
 *
 * Vercel runs Express natively on the Node.js runtime, so the whole app is one
 * function. The catch-all filename means every /api/* path lands here with its
 * original URL intact, which is what lets Express keep routing normally — no
 * rewrite needed.
 *
 * Built once per instance rather than per request: Fluid Compute reuses warm
 * instances, so this is the cheap path. Note the consequence — the in-memory
 * store is per-instance and vanishes on recycle. See server/README.md before
 * pointing real students at a deployment.
 */
const app = createApp()

export default function handler(req, res) {
  // Belt and braces: the app mounts its routes under /api, so make sure the
  // prefix is there whichever way the platform hands the path over.
  if (!req.url.startsWith('/api')) {
    req.url = `/api${req.url.startsWith('/') ? '' : '/'}${req.url}`
  }

  return app(req, res)
}
