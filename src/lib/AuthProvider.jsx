import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, getToken, onTokenChange } from './api'
import { AuthContext } from './auth'

/** Provides the signed-in user; see ./auth.js for what `null` means. */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [ready, setReady] = useState(false)
  const [problem, setProblem] = useState(null)
  /**
   * Replies waiting on the support channel, for the dot on the navbar's Support
   * button. Held here rather than fetched by every TopBar, so it is one request
   * per sign-in, and the Support page can put it out the moment it marks them
   * read. Keyed on the user id so a different account starts from its own count.
   */
  const [supportUnread, setSupportUnread] = useState(0)
  const userId = user?.id ?? null

  const refreshSupportUnread = useCallback(async () => {
    if (!getToken()) return setSupportUnread(0)
    try {
      setSupportUnread((await api.supportUnread()).unread)
    } catch {
      // A missing dot is not worth an error on every screen.
    }
  }, [])

  useEffect(() => {
    if (userId) refreshSupportUnread()
    else setSupportUnread(0)
  }, [refreshSupportUnread, userId])

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
       * participant. The student entry screen then shows them a screen meant for
       * somebody else, which is the one thing it must never do, so it reads
       * `problem` and says it cannot tell instead.
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
      signInWithNumber: async (studentNumber) => {
        const result = await api.studentLogin(studentNumber)
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
      supportUnread,
      refreshSupportUnread,
    }),
    [load, problem, ready, refreshSupportUnread, supportUnread, user],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
