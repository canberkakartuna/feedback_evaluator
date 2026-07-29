/**
 * Client for the API in ../../server.
 *
 * The components do not use this yet — they still run on the bundled copy of
 * the course. This is the seam for that swap: every call the UI needs already
 * exists here and is covered by `npm run test:api`.
 *
 * Vite proxies /api to the API server, so there is no base URL in development.
 */

const BASE = import.meta.env.VITE_API_BASE ?? ''

export class ApiError extends Error {
  constructor(status, message, details) {
    super(message)
    this.status = status
    this.details = details
  }
}

async function call(method, path, body) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })

  const text = await response.text()
  const payload = text ? JSON.parse(text) : null

  if (!response.ok) {
    throw new ApiError(
      response.status,
      payload?.error?.message ?? `Request failed with ${response.status}`,
      payload?.error?.details,
    )
  }

  return payload
}

export const api = {
  health: () => call('GET', '/api/health'),
  topics: () => call('GET', '/api/sessions/topics'),
  course: (topicId = 'all') => call('GET', `/api/course?topicId=${encodeURIComponent(topicId)}`),

  /** Consent is the session. There is no way to start one without it. */
  startSession: ({ topicId = 'all', device, conditionId } = {}) =>
    call('POST', '/api/sessions', { consent: true, topicId, device, conditionId }),
  resumeSession: (sessionId) => call('GET', `/api/sessions/${sessionId}`),
  sessionByCode: (code) => call('GET', `/api/sessions/by-code/${encodeURIComponent(code)}`),
  endSession: (sessionId) => call('POST', `/api/sessions/${sessionId}/end`),
  deleteSession: (sessionId) => call('DELETE', `/api/sessions/${sessionId}`),

  saveAnswer: (sessionId, questionId, patch) =>
    call('PUT', `/api/sessions/${sessionId}/answers/${questionId}`, patch),
  checkAnswer: (sessionId, questionId) =>
    call('POST', `/api/sessions/${sessionId}/answers/${questionId}/check`),

  messages: (sessionId, questionId) =>
    call('GET', `/api/sessions/${sessionId}/questions/${questionId}/messages`),
  sendMessage: (sessionId, questionId, text) =>
    call('POST', `/api/sessions/${sessionId}/questions/${questionId}/messages`, { text }),
  runAction: (sessionId, questionId, action) =>
    call('POST', `/api/sessions/${sessionId}/questions/${questionId}/messages`, { action }),
  rateMessage: (sessionId, messageId, value, note) =>
    call('POST', `/api/sessions/${sessionId}/messages/${messageId}/rating`, { value, note }),

  upload: (sessionId, questionId, { name, dataUrl, source = 'file' }) =>
    call('POST', `/api/sessions/${sessionId}/questions/${questionId}/uploads`, {
      name,
      dataUrl,
      source,
    }),
  removeUpload: (sessionId, questionId, uploadId) =>
    call('DELETE', `/api/sessions/${sessionId}/questions/${questionId}/uploads/${uploadId}`),

  addOwnQuestion: (sessionId, prompt) =>
    call('POST', `/api/sessions/${sessionId}/own-questions`, { prompt }),

  /** Batched: the interesting measures are gaps between timestamps. */
  sendEvents: (sessionId, events) => call('POST', `/api/sessions/${sessionId}/events`, { events }),
}
