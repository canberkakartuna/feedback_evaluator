import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useI18n } from '../../lib/i18n'
import { useAsync } from '../../lib/useAsync'
import LabellingSwitch from '../../components/LabellingSwitch'

/**
 * A manager's teachers — or, for an admin, every teacher — with the two
 * things done to a teacher's account from above: switching their labelling on
 * or off, and resetting a forgotten password.
 *
 * It is here, in the teacher console, because a manager has no other screen
 * that lists their teachers: People is admin-only, and the class list only
 * names a teacher in a picker. `GET /api/users?role=teacher` is already scoped
 * to the caller's branch by the server, so the list needs no filtering here.
 *
 * Teachers are sent back to the console's first page: they administer nobody
 * at this level, and the sidebar does not offer them this link.
 */
export default function Teachers() {
  const { user } = useAuth()
  const { lang, t } = useI18n()
  const isTeacher = user.role === 'teacher'
  const { data, error, loading, setData } = useAsync(
    () => (isTeacher ? Promise.resolve({ users: [] }) : api.users({ role: 'teacher' })),
    [isTeacher],
  )
  const [notice, setNotice] = useState(null)

  if (isTeacher) return <Navigate to="/teacher" replace />

  const teachers = data?.users ?? []

  const replace = (updated) =>
    setData((prev) => prev && { ...prev, users: prev.users.map((row) => (row.id === updated.id ? updated : row)) })

  const resetFor = async (target) => {
    const next = window.prompt(t('people.resetPrompt', { name: target.name }))
    if (!next) return
    setNotice(null)
    try {
      await api.resetPassword(target.id, next)
      setNotice({ tone: 'good', text: t('people.resetDone', { name: target.name }) })
    } catch (failure) {
      setNotice({ tone: 'bad', text: failure.message })
    }
  }

  return (
    <>
      <header className="cs-head">
        <div>
          <p className="eyebrow">{t('teachers.eyebrow')}</p>
          <h1 className="cs-title">{t('teachers.title')}</h1>
          <p className="cs-lede">
            {user.role === 'admin' ? t('teachers.ledeAdmin') : t('teachers.lede')}
          </p>
        </div>
      </header>

      {notice ? (
        <p className="cs-note" data-tone={notice.tone} role="alert" style={{ marginBottom: 'var(--s-4)' }}>
          {notice.text}
        </p>
      ) : null}

      {error ? (
        <p className="cs-note" data-tone="bad">
          {error.message}
        </p>
      ) : loading ? (
        <p className="cs-note">{t('common.loading')}</p>
      ) : teachers.length === 0 ? (
        <p className="cs-empty">{t('teachers.empty')}</p>
      ) : (
        <div className="cs-scroll-x">
          <table className="cs-table">
            <thead>
              <tr>
                <th>{t('people.thName')}</th>
                <th>{t('people.thEmail')}</th>
                <th>{t('people.thLastSeen')}</th>
                <th>{t('teachers.thLabelling')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {teachers.map((entry) => (
                <tr key={entry.id}>
                  <td>
                    {entry.name}
                    {!entry.active ? (
                      <>
                        {' '}
                        <span className="cs-pill" data-tone="quiet">
                          {t('people.inactive')}
                        </span>
                      </>
                    ) : null}
                  </td>
                  <td className="mono">{entry.email}</td>
                  <td className="mono">
                    {entry.lastLoginAt
                      ? new Date(entry.lastLoginAt).toLocaleDateString(lang)
                      : t('people.never')}
                  </td>
                  <td>
                    <LabellingSwitch teacher={entry} onChange={replace} />
                  </td>
                  <td>
                    <button type="button" className="cs-btn cs-btn-sm" onClick={() => resetFor(entry)}>
                      {t('people.reset')}
                    </button>
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
