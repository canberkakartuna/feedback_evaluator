/**
 * Stands in for src/lib/auth.jsx during the render check, so the screens can be
 * rendered as a settled identity — `ready: true` — which in the real app only
 * happens after an effect has run and a request has come back.
 */
export let CURRENT = { user: null, ready: true }

export const setCurrent = (next) => {
  CURRENT = next
}

export function AuthProvider({ children }) {
  return children
}

export function useAuth() {
  return { ...CURRENT, signIn: async () => {}, signOut: async () => {}, refresh() {}, setUser() {} }
}

export function homeFor(user) {
  if (!user) return '/'
  if (user.role === 'admin') return '/admin'
  if (user.role === 'manager' || user.role === 'teacher') return '/teacher'
  return '/'
}

export const landingFor = (user) => homeFor(user)
