import { useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useI18n } from '../../lib/i18n'
import { titleFor } from '../../../shared/activity'
import { canDeleteSessions, canForceDeleteSessions } from '../../../shared/sessionDeletion'
import {
  deletionOutcome,
  selectionSummary,
  toggleAllShown,
  toggleOne,
} from '../../lib/studentWorkSelection'
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
    const map = new Map((activities.data?.activities ?? []).map((entry) => [entry.id, titleFor(entry, lang)]))
    return (activityId) => map.get(activityId) ?? '—'
  }, [activities.data, lang])

  const rows = (sessions.data?.sessions ?? []).filter(
    (session) => !activityFilter || session.activityId === activityFilter,
  )

  /**
   * Selecting and deleting rows (teacher, manager, admin — the server checks
   * again, within the same scope that lists them). Only shown rows count: a
   * row the filter hides is never deleted by "Delete selected".
   *
   * `confirming` is the in-page confirmation: `{ ids, force }`. A second,
   * separate confirmation (`force: true`, admin only) is offered for rows the
   * server refused because their dialogs are research data.
   */
  const { user } = useAuth()
  const mayDelete = canDeleteSessions(user)
  const mayForce = canForceDeleteSessions(user)
  const [selected, setSelected] = useState(() => new Set())
  const [confirming, setConfirming] = useState(null)
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState(null)
  const [deleteError, setDeleteError] = useState(null)
  const confirmRef = useRef(null)

  const shownIds = rows.map((session) => session.id)
  const { selectedShown, all: allShown, some: someShown } = selectionSummary(shownIds, selected)

  const askToDelete = (ids, force = false) => {
    if (!ids.length) return
    setDeleteError(null)
    setConfirming({ ids, force, dialogs: force ? (outcome?.protectedDialogs ?? 0) : 0 })
    // Move focus to the question being asked, which also scrolls it into view.
    requestAnimationFrame(() => confirmRef.current?.focus())
  }

  const runDelete = async () => {
    if (!confirming) return
    setBusy(true)
    setDeleteError(null)
    try {
      const result = await api.deleteSessions(confirming.ids, { force: confirming.force })
      setOutcome(deletionOutcome(result))
      setSelected(new Set())
      setConfirming(null)
      await sessions.reload()
    } catch (problem) {
      setDeleteError(problem.message)
    } finally {
      setBusy(false)
    }
  }

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
                {titleFor(activity, lang)}
              </option>
            ))}
          </select>
        </div>
      </header>

      {mayDelete && rows.length > 0 ? (
        <div className="cs-bulk" role="group" aria-label={t('roster.bulkLabel')}>
          <label className="cs-check">
            <input
              type="checkbox"
              checked={allShown}
              disabled={busy}
              ref={(node) => {
                // "Some" is a third state a checkbox can only show from script.
                if (node) node.indeterminate = someShown
              }}
              onChange={() => setSelected(toggleAllShown(shownIds, selected))}
            />
            <span>{t('roster.selectAllShown', { count: rows.length })}</span>
          </label>
          <span className="cs-hint" aria-live="polite">
            {t('roster.selectedCount', { count: selectedShown.length })}
          </span>
          <button
            type="button"
            className="cs-btn cs-btn-sm cs-btn-danger"
            disabled={busy || selectedShown.length === 0}
            onClick={() => askToDelete(selectedShown)}
          >
            {t('roster.deleteSelected')}
          </button>
        </div>
      ) : null}

      {confirming ? (
        <section
          className="cs-note cs-confirm"
          data-tone={confirming.force ? 'bad' : 'warn'}
          role="alertdialog"
          aria-labelledby="roster-confirm-title"
          aria-describedby="roster-confirm-body"
          tabIndex={-1}
          ref={confirmRef}
        >
          <p id="roster-confirm-title" className="cs-confirm-title">
            {confirming.force
              ? t('roster.forceTitle', { count: confirming.ids.length })
              : t('roster.confirmTitle', { count: confirming.ids.length })}
          </p>
          <div id="roster-confirm-body">
            <p>{t('roster.confirmBody')}</p>
            <p>
              {confirming.force
                ? t('roster.forceBody', { dialogs: confirming.dialogs })
                : t('roster.confirmProtected')}
            </p>
          </div>
          {deleteError ? (
            <p className="cs-note" data-tone="bad" role="alert">
              {deleteError}
            </p>
          ) : null}
          <div className="cs-actions">
            <button type="button" className="cs-btn" disabled={busy} onClick={() => setConfirming(null)}>
              {t('common.cancel')}
            </button>
            <button type="button" className="cs-btn cs-btn-danger" disabled={busy} onClick={runDelete}>
              {busy
                ? t('roster.deleting')
                : confirming.force
                  ? t('roster.forceConfirm', { count: confirming.ids.length })
                  : t('roster.confirmDelete', { count: confirming.ids.length })}
            </button>
          </div>
        </section>
      ) : null}

      {outcome ? (
        <div
          className="cs-note cs-confirm"
          data-tone={outcome.protectedCount || outcome.failed ? 'warn' : 'good'}
          role="status"
        >
          <p>
            {outcome.deleted
              ? t('roster.resultDeleted', { count: outcome.deleted })
              : t('roster.resultNone')}
          </p>
          {outcome.protectedCount ? (
            <p>{t('roster.resultProtected', { count: outcome.protectedCount })}</p>
          ) : null}
          {outcome.failed ? <p>{t('roster.resultFailed', { count: outcome.failed })}</p> : null}
          <div className="cs-actions">
            {outcome.protectedCount && mayForce && !confirming ? (
              <button
                type="button"
                className="cs-btn cs-btn-sm cs-btn-danger"
                disabled={busy}
                onClick={() => askToDelete(outcome.protectedIds, true)}
              >
                {t('roster.forceOffer', { count: outcome.protectedCount })}
              </button>
            ) : null}
            <button type="button" className="cs-btn cs-btn-sm" onClick={() => setOutcome(null)}>
              {t('common.dismiss')}
            </button>
          </div>
        </div>
      ) : null}

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
                {mayDelete ? (
                  <th>
                    <span className="sr-only">{t('roster.thSelect')}</span>
                  </th>
                ) : null}
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
                  {mayDelete ? (
                    <td>
                      <input
                        type="checkbox"
                        className="cs-row-check"
                        aria-label={t('roster.selectEntry', { code: session.code })}
                        checked={selected.has(session.id)}
                        disabled={busy}
                        onChange={() => setSelected(toggleOne(selected, session.id))}
                      />
                    </td>
                  ) : null}
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
                    <div className="cs-row-actions">
                      <Link className="cs-btn cs-btn-sm" to={`/teacher/students/${session.id}`}>
                        {t('roster.read')}
                      </Link>
                      {mayDelete ? (
                        <button
                          type="button"
                          className="cs-btn cs-btn-sm cs-btn-danger"
                          aria-label={t('roster.deleteEntry', { code: session.code })}
                          disabled={busy}
                          onClick={() => askToDelete([session.id])}
                        >
                          {t('common.delete')}
                        </button>
                      ) : null}
                    </div>
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
