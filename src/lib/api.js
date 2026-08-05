/**
 * Client for the API in ../../server.
 *
 * One call per endpoint, grouped the way the routes are, so a screen never
 * builds a URL itself. Vite proxies /api to the API server, so there is no base
 * URL in development.
 *
 * **The login token is held here**, not passed down through props.
 *
 * Every request sends it if there is one, which is what lets an anonymous
 * student and a signed-in teacher share the same functions: the anonymous
 * student simply has no token, and the routes that do not need one do not care.
 * It is kept in localStorage so a refresh does not sign a teacher out
 * mid-marking, and cleared on any 401 — a token the server has stopped
 * accepting is worse than no token, because it makes every later call fail in a
 * way the UI would otherwise have to guess at.
 */

const BASE = import.meta.env.VITE_API_BASE ?? ''
const TOKEN_KEY = 'dropshot.token'

export class ApiError extends Error {
  constructor(status, message, details) {
    super(message)
    this.status = status
    this.details = details
  }
}

let token = null
try {
  token = localStorage.getItem(TOKEN_KEY)
} catch {
  // Private browsing, or storage disabled. Sign-in still works for this tab;
  // it just will not survive a refresh, which is better than not loading.
}

const listeners = new Set()

export function getToken() {
  return token
}

export function setToken(next) {
  token = next || null
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    // As above — an unwritable store is not a reason to fail the sign-in.
  }
  for (const listener of listeners) listener(token)
}

/** Lets the auth context re-read `me` when a 401 clears the token underneath it. */
export function onTokenChange(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

async function call(method, path, body) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  const text = await response.text()
  let payload = null
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    payload = null
  }

  if (!response.ok) {
    // A rejected token is dropped rather than retried with. Anonymous routes
    // keep working; anything that needed an identity now says so cleanly.
    if (response.status === 401 && token) setToken(null)

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

  /* ---------------------------------------------------------------- accounts */

  login: async (email, password) => {
    const result = await call('POST', '/api/auth/login', { email, password })
    setToken(result.token)
    return result
  },
  logout: async () => {
    try {
      await call('POST', '/api/auth/logout')
    } finally {
      // Cleared even if the call failed: the point of pressing sign out is to
      // stop being signed in here, whatever the server managed to record.
      setToken(null)
    }
  },
  me: () => call('GET', '/api/auth/me'),
  /**
   * "I agree to the research notice", recorded against the account so a student
   * with a password is asked once rather than every visit. No body: the date and
   * the wording version are the server's to know. Returns the updated user.
   */
  recordConsent: () => call('POST', '/api/auth/consent'),
  changePassword: async (currentPassword, newPassword) => {
    const result = await call('POST', '/api/auth/password', { currentPassword, newPassword })
    setToken(result.token)
    return result
  },
  bootstrap: async (bootstrapToken, body) => {
    const previous = token
    setToken(bootstrapToken)
    try {
      const result = await call('POST', '/api/auth/bootstrap', body)
      setToken(result.token)
      return result
    } catch (error) {
      setToken(previous)
      throw error
    }
  },

  /* ------------------------------------------------------------------- users */

  users: (query = {}) => {
    const search = new URLSearchParams(
      Object.entries(query).filter(([, value]) => value != null && value !== ''),
    ).toString()
    return call('GET', `/api/users${search ? `?${search}` : ''}`)
  },
  user: (userId) => call('GET', `/api/users/${userId}`),
  createUser: (body) => call('POST', '/api/users', body),
  updateUser: (userId, patch) => call('PATCH', `/api/users/${userId}`, patch),
  deleteUser: (userId) => call('DELETE', `/api/users/${userId}`),
  resetPassword: (userId, newPassword) =>
    call('POST', `/api/users/${userId}/password`, { newPassword }),
  userSessions: (userId) => call('GET', `/api/users/${userId}/sessions`),

  /* -------------------------------------------------------------- activities */

  activities: () => call('GET', '/api/activities'),
  activity: (activityId) => call('GET', `/api/activities/${activityId}`),
  activityPreview: (activityId) => call('GET', `/api/activities/${activityId}/preview`),
  createActivity: (body) => call('POST', '/api/activities', body),
  updateActivity: (activityId, patch) => call('PATCH', `/api/activities/${activityId}`, patch),
  deleteActivity: (activityId) => call('DELETE', `/api/activities/${activityId}`),

  addQuestion: (activityId, body) => call('POST', `/api/activities/${activityId}/questions`, body),
  updateQuestion: (activityId, questionId, patch) =>
    call('PATCH', `/api/activities/${activityId}/questions/${questionId}`, patch),
  deleteQuestion: (activityId, questionId) =>
    call('DELETE', `/api/activities/${activityId}/questions/${questionId}`),
  reorderQuestions: (activityId, questionIds) =>
    call('POST', `/api/activities/${activityId}/questions/reorder`, { questionIds }),

  /**
   * What the person looking may start. Sends the token when there is one, which
   * narrows it to their own teacher's work; without one it is every published
   * activity, which is the anonymous door.
   */
  availableActivities: () => call('GET', '/api/activities/available'),

  /**
   * The other student door: one activity, by the class code a teacher read out.
   * Open, like the list — a code names something publishing already opened.
   */
  activityByCode: (code) =>
    call('GET', `/api/activities/code/${encodeURIComponent(String(code).trim())}`),

  /* ---------------------------------------------------------------- sessions */

  /**
   * Consent is the session, and it is passed explicitly rather than hard-coded.
   *
   * Everyone who gets this far has ticked the box, so every caller sends `true`
   * — and still sends it, rather than leaning on a default, because this is the
   * one field in the study nobody may fudge and it should be readable at the
   * call site. Staff no longer reach it at all: the entry screens send them to
   * their console, and `POST /api/sessions` refuses a staff account outright.
   *
   * `activityId` or `code`: whichever door they came through. `nickname` is what
   * an anonymous session is called on a teacher's roster; the server ignores it
   * for a signed-in one, which already has a name.
   */
  startSession: ({ activityId, code, device, nickname, consent = true } = {}) =>
    call('POST', '/api/sessions', { consent, activityId, code, device, nickname }),
  resumeSession: (sessionId) => call('GET', `/api/sessions/${sessionId}`),
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

  /* ------------------------------------------------------- prompts + reading */

  prompts: () => call('GET', '/api/prompts'),
  setPrompt: (text, note) => call('POST', '/api/prompts', { text, note }),

  researchSessions: () => call('GET', '/api/research/sessions'),
  transcript: (sessionId) => call('GET', `/api/research/sessions/${sessionId}/transcript`),
  snippets: (query = {}) => {
    const search = new URLSearchParams(
      Object.entries(query).filter(([, value]) => value != null && value !== ''),
    ).toString()
    return call('GET', `/api/research/snippets${search ? `?${search}` : ''}`)
  },
  labelSnippet: (snippetId, patch) =>
    call('PATCH', `/api/research/snippets/${encodeURIComponent(snippetId)}`, patch),
  exportUrl: (format = 'json') => `${BASE}/api/research/export?format=${format}`,
}
