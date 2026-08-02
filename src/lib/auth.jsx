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

  const load = useCallback(async () => {
    if (!getToken()) {
      setUser(null)
      setReady(true)
      return
    }

    try {
      const { user: me } = await api.me()
      setUser(me)
    } catch {
      // api.call already dropped the token on a 401. Anything else — the API
      // being down — is also not a signed-in state, and the screens handle
      // "nobody" already.
      setUser(null)
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
      signIn: async (email, password) => {
        const result = await api.login(email, password)
        setUser(result.user)
        return result.user
      },
      signOut: async () => {
        await api.logout()
        setUser(null)
      },
      refresh: load,
      setUser,
    }),
    [load, ready, user],
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
