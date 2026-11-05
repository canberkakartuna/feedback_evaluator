import { createContext, useContext } from 'react'

/**
 * Who is signed in, if anyone.
 *
 * `null` is a normal, supported state and not an error: a student joining with
 * a code never signs in at all, so every screen that uses this has to read
 * "nobody" as an answer rather than a loading condition. `ready` is what
 * separates the two — it is false only until the first `me` call settles, and
 * routing decisions wait on it so a teacher refreshing a page is not bounced to
 * the sign-in screen for the half-second before their token is confirmed.
 *
 * The provider lives in ./AuthProvider.jsx; this file holds everything else, so
 * that file exports only a component and Fast Refresh can hot-swap it.
 */
export const AuthContext = createContext(null)

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
 * back on the student entry screen instead of their console.
 */
export function landingFor(user, from) {
  const home = homeFor(user)
  if (!from || home === '/') return home
  return from === home || from.startsWith(`${home}/`) ? from : home
}
