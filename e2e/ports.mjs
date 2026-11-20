/**
 * Where the e2e servers listen. Clear of the development ports (API 4000,
 * Vite 5173) and the others in use locally (4100, 5180), so the suite can run
 * while you are working against those. Override with E2E_API_PORT /
 * E2E_WEB_PORT if these are taken.
 */
const apiPort = Number(process.env.E2E_API_PORT ?? 4410)
const webPort = Number(process.env.E2E_WEB_PORT ?? 5290)

export const E2E = {
  apiPort,
  webPort,
  apiOrigin: `http://localhost:${apiPort}`,
  webOrigin: `http://localhost:${webPort}`,
  /** Known values for a throwaway in-memory server; they guard nothing real. */
  bootstrapToken: 'e2e-bootstrap-token',
  researchToken: 'e2e-research-token',
  admin: { name: 'E2E Admin', email: 'e2e-admin@example.com', password: 'e2e admin password' },
}
