import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { api, getToken, onTokenChange } from './api'

/**
 * Who is signed in, if anyone.
 *
 * `null` is a normal, supported state and not an error: a student joining with
 * a code never signs in at all, so every screen that uses this has to read
 * "nobody" as an answer rather than a loading condition. `ready` is what
 * separates the two — it is false only until the first `me` call settles, and
 * routing decisions wait on it so a teacher refreshing a page is not bounced to
 * the sign-in screen for the half-second before their token is confirmed.
 */
const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [ready, setReady] = useState(false)
  const [problem, setProblem] = useState(null)

  const load = useCallback(async () => {
    if (!getToken()) {
      setUser(null)
      setProblem(null)
      setReady(true)
      return
    }

    try {
      const { user: me } = await api.me()
      setUser(me)
      setProblem(null)
    } catch (error) {
      setUser(null)

      /**
       * "Nobody" and "could not tell" are different answers, and this is where
       * the difference is kept.
       *
       * A **401** is an answer: the token is dead, api.call has already dropped
       * it, and this really is an anonymous visitor. Anything else — the API
       * down, a proxy 502, a dropped connection — is *not* an answer, and
       * treating it as one silently demotes a signed-in teacher to an anonymous
       * participant. The student entry screen then shows them a research consent
       * form addressed to somebody else, which is the one thing it must never
       * do, so it reads `problem` and says it cannot tell instead.
       */
      setProblem(error.status === 401 ? null : error)
    } finally {
      setReady(true)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // A 401 anywhere in the app clears the token; this is how the rest of the UI
  // finds out, rather than each screen having to notice for itself.
  useEffect(() => onTokenChange((next) => !next && setUser(null)), [])

  const value = useMemo(
    () => ({
      user,
      ready,
      /** Non-null only when a token exists but could not be checked. */
      problem,
      signIn: async (email, password) => {
        const result = await api.login(email, password)
        setUser(result.user)
        setProblem(null)
        return result.user
      },
      signOut: async () => {
        await api.logout()
        setUser(null)
        setProblem(null)
      },
      refresh: load,
      setUser,
    }),
    [load, problem, ready, user],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>')
  return value
}

/** Where each role belongs when they land on the site root or just signed in. */
export function homeFor(user) {
  if (!user) return '/'
  if (user.role === 'admin') return '/admin'
  if (user.role === 'manager' || user.role === 'teacher') return '/teacher'
  return '/'
}

/**
 * Where to send someone the moment they sign in.
 *
 * `from` is only worth honouring when it is a page inside that person's own
 * console — the Guard sets it when it turns a teacher away from, say,
 * /teacher/students, and returning them there is the whole point. Anything else
 * is a page they merely happened to be on: the student entry screen sets
 * `from: '/'` for its "Sign in" link, and honouring that would land a teacher
 * back on the student consent form instead of their console.
 */
export function landingFor(user, from) {
  const home = homeFor(user)
  if (!from || home === '/') return home
  return from === home || from.startsWith(`${home}/`) ? from : home
}
