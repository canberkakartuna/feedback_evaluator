import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../../lib/api'
import { useAsync } from '../../lib/useAsync'

const when = (iso) =>
  new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })

/**
 * Everyone who has been in, and how much they produced.
 *
 * A row is a **session**, not a student, because most students here have no
 * account at all — they came in anonymously, with no code and no password. Their
 * work still has to be visible, and it is: an anonymous session is attached to
 * the activity it was started from, so it reaches the teacher who owns that
 * activity. A signed-in student's name is shown when there is one; the session's
 * own short code stands in when there is not, which is the only handle an
 * anonymous session has.
 *
 * `questionsWithChat` is the column the doc actually asks for: not which
 * questions were opened, but which ones produced a conversation. That is what
 * separates a session worth reading from one where somebody clicked through.
 */
export default function Roster() {
  const [params, setParams] = useSearchParams()
  const activityFilter = params.get('activity') ?? ''

  const sessions = useAsync(() => api.researchSessions(), [])
  const activities = useAsync(() => api.activities(), [])
  const students = useAsync(() => api.users({ role: 'student' }), [])

  const nameOf = useMemo(() => {
    const map = new Map((students.data?.users ?? []).map((user) => [user.id, user.name]))
    return (userId) => (userId ? (map.get(userId) ?? 'Signed-in student') : null)
  }, [students.data])

  const titleOf = useMemo(() => {
    const map = new Map((activities.data?.activities ?? []).map((entry) => [entry.id, entry.title]))
    return (activityId) => map.get(activityId) ?? '—'
  }, [activities.data])

  const rows = (sessions.data?.sessions ?? []).filter(
    (session) => !activityFilter || session.activityId === activityFilter,
  )

  return (
    <>
      <header className="cs-head">
        <div>
          <p className="eyebrow">Reading</p>
          <h1 className="cs-title">Student work</h1>
          <p className="cs-lede">
            One row per session. Open one to read it question by question, then send the useful
            exchanges through to labelling.
          </p>
        </div>

        <div className="cs-field">
          <label className="cs-label" htmlFor="filter">
            Activity
          </label>
          <select
            id="filter"
            className="cs-select"
            value={activityFilter}
            onChange={(event) => {
              const next = event.target.value
              setParams(next ? { activity: next } : {}, { replace: true })
            }}
          >
            <option value="">All</option>
            {(activities.data?.activities ?? []).map((activity) => (
              <option key={activity.id} value={activity.id}>
                {activity.title}
              </option>
            ))}
          </select>
        </div>
      </header>

      {sessions.error ? (
        <p className="cs-note" data-tone="bad">
          {sessions.error.message}
        </p>
      ) : sessions.loading ? (
        <p className="cs-note">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="cs-empty">
          Nothing yet. Publish an activity and sessions appear here as students work through it.
        </p>
      ) : (
        <div className="cs-scroll-x">
          <table className="cs-table">
            <thead>
              <tr>
                <th>Student</th>
                <th>Activity</th>
                <th>Started</th>
                <th>Questions with chat</th>
                <th>Messages</th>
                <th>Snippets</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((session) => (
                <tr key={session.id}>
                  <td>
                    {nameOf(session.userId) ?? (
                      <>
                        <span className="cs-pill" data-tone="quiet">
                          anonymous
                        </span>{' '}
                        <span className="mono">{session.code}</span>
                      </>
                    )}
                  </td>
                  <td>{titleOf(session.activityId)}</td>
                  <td className="mono">{when(session.createdAt)}</td>
                  <td className="mono">{session.counts.questionsWithChat}</td>
                  <td className="mono">{session.counts.messages}</td>
                  <td className="mono">{session.counts.snippets}</td>
                  <td>
                    <Link className="cs-btn cs-btn-sm" to={`/teacher/students/${session.id}`}>
                      Read
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
