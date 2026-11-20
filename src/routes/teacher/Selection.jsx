import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../../lib/api'
import { studentLabel } from '../../lib/datasets'
import { useI18n } from '../../lib/i18n'
import { useAsync } from '../../lib/useAsync'
import { titleFor } from '../../../shared/activity'

/** Dates in the interface language, as on the roster. */
const when = (iso, lang) =>
  iso
    ? new Date(iso).toLocaleString(lang, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : '—'

/**
 * Dialog selection, step one: the students whose work this person can see.
 *
 * Picking dialogs into a dataset starts from a person rather than from one long
 * list of exchanges: open a student, read their dialogs question by question,
 * and add the ones worth studying (SelectionStudent). The list is the server's
 * (`GET /api/research/students`), already scoped the way the roster is — a
 * teacher their own students and the anonymous work on their activities, a
 * manager their branch, an admin everyone — and names a student only where the
 * roster would. A signed-in student is one row across all their sessions; an
 * anonymous session is a row of its own, as it is on the roster.
 *
 * The activity filter is the roster's; "only with dialogs" hides students who
 * never spoke to the tutor, which is most of what there is nothing to pick from.
 */
export default function Selection() {
  const [params, setParams] = useSearchParams()
  const { lang, t } = useI18n()
  const activityFilter = params.get('activity') ?? ''
  const withDialogsOnly = params.get('all') !== '1'

  const students = useAsync(() => api.selectionStudents(), [])
  const activities = useAsync(() => api.activities(), [])

  const titleOf = useMemo(() => {
    const map = new Map((activities.data?.activities ?? []).map((entry) => [entry.id, titleFor(entry, lang)]))
    return (activityId) => map.get(activityId) ?? '—'
  }, [activities.data, lang])

  const rows = (students.data?.students ?? []).filter(
    (row) =>
      (!activityFilter || row.activityIds.includes(activityFilter)) && (!withDialogsOnly || row.dialogCount > 0),
  )

  const setParam = (name, value) => {
    const next = new URLSearchParams(params)
    if (value) next.set(name, value)
    else next.delete(name)
    setParams(next, { replace: true })
  }

  return (
    <>
      <header className="cs-head">
        <div>
          <p className="eyebrow">{t('selection.eyebrow')}</p>
          <h1 className="cs-title">{t('selection.title')}</h1>
          <p className="cs-lede">{t('selection.lede')}</p>
        </div>

        <div className="cs-actions" style={{ alignItems: 'flex-end' }}>
          <div className="cs-field">
            <label className="cs-label" htmlFor="selection-activity">
              {t('roster.activity')}
            </label>
            <select
              id="selection-activity"
              className="cs-select"
              value={activityFilter}
              onChange={(event) => setParam('activity', event.target.value)}
            >
              <option value="">{t('common.all')}</option>
              {(activities.data?.activities ?? []).map((activity) => (
                <option key={activity.id} value={activity.id}>
                  {titleFor(activity, lang)}
                </option>
              ))}
            </select>
          </div>
          <label className="cs-check">
            <input
              type="checkbox"
              checked={withDialogsOnly}
              onChange={(event) => setParam('all', event.target.checked ? '' : '1')}
            />
            <span>{t('selection.withDialogsOnly')}</span>
          </label>
        </div>
      </header>

      {students.error ? (
        <p className="cs-note" data-tone="bad">
          {students.error.message}
        </p>
      ) : students.loading ? (
        <p className="cs-note">{t('common.loading')}</p>
      ) : rows.length === 0 ? (
        <p className="cs-empty">{t('selection.empty')}</p>
      ) : (
        <div className="cs-scroll-x">
          <table className="cs-table">
            <thead>
              <tr>
                <th>{t('roster.thStudent')}</th>
                <th>{t('roster.thActivity')}</th>
                <th>{t('selection.thQuestions')}</th>
                <th>{t('selection.thDialogs')}</th>
                <th>{t('selection.thInDataset')}</th>
                <th>{t('selection.thLastActive')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const { label, code, tone } = studentLabel(row, t)
                return (
                  <tr key={row.key}>
                    <td>
                      {tone ? (
                        <>
                          <span className="cs-pill" data-tone={tone}>
                            {row.kind === 'preview' ? t('roster.preview') : t('roster.anonymous')}
                          </span>{' '}
                        </>
                      ) : null}
                      {row.kind === 'preview' ? null : <strong>{label}</strong>}{' '}
                      {code ? <span className="mono">{code}</span> : null}
                      {row.consentWithdrawn ? (
                        <>
                          {' '}
                          <span className="cs-pill" data-tone="quiet">
                            {t('transcript.consentWithdrawn')}
                          </span>
                        </>
                      ) : null}
                    </td>
                    <td>{row.activityIds.map(titleOf).join(', ') || '—'}</td>
                    <td className="mono">{row.questionCount}</td>
                    <td className="mono">{row.dialogCount}</td>
                    <td className="mono">{row.inDatasetCount}</td>
                    <td className="mono">{when(row.lastAt, lang)}</td>
                    <td>
                      <Link className="cs-btn cs-btn-sm" to={`/teacher/selection/${encodeURIComponent(row.key)}`}>
                        {t('selection.open')}
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
