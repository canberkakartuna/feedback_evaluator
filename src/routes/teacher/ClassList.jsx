import { useState } from 'react'
import { splitStudentNumbers } from '../../../shared/student-number'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useI18n } from '../../lib/i18n'
import { useAsync } from '../../lib/useAsync'

const when = (iso, lang) =>
  iso
    ? new Date(iso).toLocaleString(lang, {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—'

/**
 * Who may sign in with a student number: the class list.
 *
 * A teacher pastes their class's numbers here — a column copied out of a
 * spreadsheet, or a comma list — and each one becomes an account that signs in
 * with the number alone (see shared/student-number.js). Nobody else gets in,
 * which is the point: the tutor is for the class, and so is its bill.
 *
 * Removing a number deactivates the account rather than deleting it: their work
 * stays attributable, and pasting the number again puts them back.
 *
 * A manager or admin keeps a list on behalf of a teacher, so for them the
 * teacher is picked first; the server checks that teacher is theirs to reach.
 */
export default function ClassList() {
  const { lang, t } = useI18n()
  const { user } = useAuth()
  const forOthers = user.role !== 'teacher'

  const [paste, setPaste] = useState('')
  const [teacherId, setTeacherId] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  const students = useAsync(() => api.users({ role: 'student' }), [])
  const teachers = useAsync(
    () => (forOthers ? api.users({ role: 'teacher' }) : Promise.resolve({ users: [] })),
    [forOthers],
  )

  const owner = forOthers ? teacherId : user.id
  const listed = (students.data?.users ?? [])
    .filter((entry) => entry.studentNumber && (!forOthers || entry.teacherId === teacherId))
    .sort((a, b) => a.studentNumber.localeCompare(b.studentNumber))

  const add = async (event) => {
    event.preventDefault()
    const numbers = splitStudentNumbers(paste)
    if (!numbers.length) return

    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const outcome = await api.addToClassList(numbers, forOthers ? teacherId : undefined)
      setResult(outcome)
      setPaste('')
      students.reload()
    } catch (failure) {
      setError(failure.message)
    } finally {
      setBusy(false)
    }
  }

  const setActive = async (entry, active) => {
    setError(null)
    try {
      await api.updateUser(entry.id, { active })
      students.reload()
    } catch (failure) {
      setError(failure.message)
    }
  }

  return (
    <>
      <header className="cs-head">
        <div>
          <p className="eyebrow">{t('classList.eyebrow')}</p>
          <h1 className="cs-title">{t('classList.title')}</h1>
          <p className="cs-lede">{t('classList.lede')}</p>
        </div>
      </header>

      <form className="cs-form" onSubmit={add}>
        {forOthers ? (
          <div className="cs-field">
            <label className="cs-label" htmlFor="cl-teacher">
              {t('classList.teacher')}
            </label>
            <select
              id="cl-teacher"
              className="cs-select"
              value={teacherId}
              onChange={(event) => setTeacherId(event.target.value)}
            >
              <option value="">{t('classList.pickTeacher')}</option>
              {(teachers.data?.users ?? []).map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <div className="cs-field">
          <label className="cs-label" htmlFor="cl-paste">
            {t('classList.paste')}
          </label>
          <textarea
            id="cl-paste"
            className="cs-textarea mono"
            rows={5}
            placeholder={'20230145\n20230146\n20230147'}
            value={paste}
            onChange={(event) => setPaste(event.target.value)}
          />
          <p className="cs-hint">{t('classList.pasteHint')}</p>
        </div>

        {error ? (
          <p className="cs-note" data-tone="bad" role="alert">
            {error}
          </p>
        ) : null}

        {result ? (
          <p className="cs-note" role="status">
            {[
              t('classList.added', { count: result.added.length }),
              result.already.length ? t('classList.already', { count: result.already.length }) : null,
              result.taken.length
                ? t('classList.taken', { count: result.taken.length, numbers: result.taken.join(', ') })
                : null,
              result.invalid.length
                ? t('classList.invalid', { count: result.invalid.length, entries: result.invalid.join(', ') })
                : null,
            ]
              .filter(Boolean)
              .join(' ')}
          </p>
        ) : null}

        <div className="cs-actions">
          <button
            type="submit"
            className="cs-btn cs-btn-primary"
            disabled={busy || !paste.trim() || !owner}
          >
            {busy ? t('common.saving') : t('classList.add')}
          </button>
        </div>
      </form>

      {students.error ? (
        <p className="cs-note" data-tone="bad">
          {students.error.message}
        </p>
      ) : students.loading ? (
        <p className="cs-note">{t('common.loading')}</p>
      ) : listed.length === 0 ? (
        <p className="cs-empty">{t('classList.empty')}</p>
      ) : (
        <div className="cs-scroll-x">
          <p className="cs-hint">
            {t('classList.count', { count: listed.filter((entry) => entry.active).length })}
          </p>
          <table className="cs-table">
            <thead>
              <tr>
                <th>{t('classList.thNumber')}</th>
                <th>{t('classList.thLastIn')}</th>
                <th>{t('classList.thConsent')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {listed.map((entry) => (
                <tr key={entry.id}>
                  <td className="mono">
                    {entry.studentNumber}{' '}
                    {entry.active ? null : (
                      <span className="cs-pill" data-tone="quiet">
                        {t('classList.removed')}
                      </span>
                    )}
                  </td>
                  <td className="mono">{when(entry.lastLoginAt, lang)}</td>
                  <td>{entry.consented ? t('classList.consentYes') : t('classList.consentNo')}</td>
                  <td>
                    <button
                      type="button"
                      className="cs-btn cs-btn-sm"
                      onClick={() => setActive(entry, !entry.active)}
                    >
                      {entry.active ? t('classList.remove') : t('classList.restore')}
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
