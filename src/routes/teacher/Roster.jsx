import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../../lib/api'
import { useI18n } from '../../lib/i18n'
import { useAsync } from '../../lib/useAsync'

/**
 * Dates follow the interface language rather than the machine's.
 *
 * `undefined` as a locale means "whatever this browser is set to", which on a
 * shared school machine set to English would print English months next to
 * Turkish column headings. Somebody who has chosen TR has said which language
 * they are reading in; a date is part of that.
 */
const when = (iso, lang) =>
  new Date(iso).toLocaleString(lang, {
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
 * activity. A signed-in student's name is shown when there is one, an anonymous
 * student's **nickname** when they offered one, and the session's own short code
 * when they did not — which used to be the only handle an anonymous session had.
 *
 * A teacher's **own walkthrough** shows here too and is labelled as one. It is
 * not a student's work and must not be read as one — see routes/sessions.js on
 * why staff sessions carry no consent record.
 *
 * `questionsWithChat` is the column the doc actually asks for: not which
 * questions were opened, but which ones produced a conversation. That is what
 * separates a session worth reading from one where somebody clicked through.
 */
export default function Roster() {
  const [params, setParams] = useSearchParams()
  const { lang, t } = useI18n()
  const activityFilter = params.get('activity') ?? ''

  const sessions = useAsync(() => api.researchSessions(), [])
  const activities = useAsync(() => api.activities(), [])
  const students = useAsync(() => api.users({ role: 'student' }), [])

  const nameOf = useMemo(() => {
    const map = new Map((students.data?.users ?? []).map((user) => [user.id, user.name]))
    return (userId) => (userId ? (map.get(userId) ?? t('roster.signedInStudent')) : null)
  }, [students.data, t])

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
          <p className="eyebrow">{t('roster.eyebrow')}</p>
          <h1 className="cs-title">{t('roster.title')}</h1>
          <p className="cs-lede">{t('roster.lede')}</p>
        </div>

        <div className="cs-field">
          <label className="cs-label" htmlFor="filter">
            {t('roster.activity')}
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
            <option value="">{t('common.all')}</option>
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
        <p className="cs-note">{t('common.loading')}</p>
      ) : rows.length === 0 ? (
        <p className="cs-empty">{t('roster.empty')}</p>
      ) : (
        <div className="cs-scroll-x">
          <table className="cs-table">
            <thead>
              <tr>
                <th>{t('roster.thStudent')}</th>
                <th>{t('roster.thActivity')}</th>
                <th>{t('roster.thStarted')}</th>
                <th>{t('roster.thQuestionsWithChat')}</th>
                <th>{t('roster.thMessages')}</th>
                <th>{t('roster.thSnippets')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((session) => (
                <tr key={session.id}>
                  <td>
                    {/* Only ever an old row: staff cannot start a session now.
                        The ones they started before that are still here, and a
                        walkthrough that stopped being labelled would be counted
                        as somebody's work. */}
                    {session.staffPreview ? (
                      <>
                        <span className="cs-pill" data-tone="draft">
                          {t('roster.preview')}
                        </span>{' '}
                        <span className="mono">{session.code}</span>
                      </>
                    ) : (
                      (nameOf(session.userId) ?? (
                        <>
                          <span className="cs-pill" data-tone="quiet">
                            {t('roster.anonymous')}
                          </span>{' '}
                          {/* A nickname they made up, or the code as before. The
                              code stays visible either way: it is the handle the
                              student can read back off their own screen. */}
                          {session.nickname ? <strong>{session.nickname}</strong> : null}{' '}
                          <span className="mono">{session.code}</span>
                        </>
                      ))
                    )}
                  </td>
                  <td>{titleOf(session.activityId)}</td>
                  <td className="mono">{when(session.createdAt, lang)}</td>
                  <td className="mono">{session.counts.questionsWithChat}</td>
                  <td className="mono">{session.counts.messages}</td>
                  <td className="mono">{session.counts.snippets}</td>
                  <td>
                    <Link className="cs-btn cs-btn-sm" to={`/teacher/students/${session.id}`}>
                      {t('roster.read')}
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
