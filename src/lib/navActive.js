/**
 * Whether a nav link is the tab the current page belongs to.
 *
 *   to     the link's own path; matches itself and anything below it
 *   end    match `to` exactly, nothing below it — for an index tab such as
 *          /teacher, which would otherwise be "current" on every console page
 *   also   further path prefixes that count as this tab: /teacher/activities
 *          belongs to the Activities tab even though the tab itself is the
 *          /teacher index
 *
 * Segment-aware, like React Router's NavLink: /teacher/support does not match
 * /teacher/supporters.
 */
export function isNavActive(pathname, { to, end = false, also = [] }) {
  const path = trimSlash(pathname)
  const under = (prefix) => {
    const base = trimSlash(prefix)
    return path === base || path.startsWith(base === '/' ? '/' : `${base}/`)
  }

  if (path === trimSlash(to)) return true
  if (!end && under(to)) return true
  return also.some(under)
}

function trimSlash(path) {
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path
}
