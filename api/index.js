import { createApp } from '../server/app.js'

/**
 * Vercel entry point.
 *
 * Vercel runs Express natively on the Node.js runtime, so the whole API is one
 * function. The `/api/(.*)` rewrite in vercel.json points every API path here
 * while Express still sees the original URL, which is what lets it route
 * normally.
 *
 * A file-based route alone was not enough: `api/[...path].js` matched only one
 * segment, so everything nested — /api/sessions/:id/..., /api/research/* —
 * returned Vercel's own 404 without ever reaching Express. The rewrite is what
 * makes nested paths work.
 *
 * Built once per instance rather than per request: Fluid Compute reuses warm
 * instances, so this is the cheap path, and the Mongo connection pool is shared
 * by every request an instance serves rather than opened per invocation.
 *
 * The deployment reads no `.env` file — server/config.js skips the merge when
 * `VERCEL` is set — so `MONGODB_URI` and every other value have to come from
 * the project's environment settings. Uploads are still per-instance and do
 * not survive; see server/README.md before pointing real students at a
 * deployment.
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
