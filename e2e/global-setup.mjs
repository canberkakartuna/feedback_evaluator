import { E2E } from './ports.mjs'

/**
 * Runs once, after both servers are up: creates the first admin on the fresh
 * in-memory store, so every test can make its own teacher, class list and
 * activity through the API (support/seed.mjs).
 */
export default async function globalSetup() {
  const response = await fetch(`${E2E.apiOrigin}/api/auth/bootstrap`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${E2E.bootstrapToken}` },
    body: JSON.stringify(E2E.admin),
  })
  if (response.status !== 201) {
    throw new Error(`e2e bootstrap failed with ${response.status}: ${await response.text()}`)
  }

  const health = await (await fetch(`${E2E.apiOrigin}/api/health`)).json()
  // Belt and braces with serve-api.mjs: never a real database, model or bucket.
  if (health.store !== 'memory' || health.tutor !== 'scripted' || health.uploads !== 'disk') {
    throw new Error(
      `e2e API is not isolated: store=${health.store} tutor=${health.tutor} uploads=${health.uploads}`,
    )
  }
}
