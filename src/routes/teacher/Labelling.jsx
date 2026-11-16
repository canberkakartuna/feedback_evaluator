import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import MathText from '../../components/MathText'
import { promptFor } from '../../../shared/activity'
import { teacherCanLabel } from '../../../shared/roles'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useI18n } from '../../lib/i18n'
import { useAsync } from '../../lib/useAsync'

/** Three answers, translated by id — see `labelling.*` in src/lib/strings.js. */
const VALUES = ['yes', 'partly', 'no']

/** How long "Saved" stays up before only the standing state is left. */
const SAVED_FOR_MS = 2500

/** Date and time in the reader's language, or nothing for a missing stamp. */
function When({ iso, lang }) {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null

  return (
    <time className="cs-when" dateTime={date.toISOString()}>
      {date.toLocaleString(lang, { dateStyle: 'medium', timeStyle: 'short' })}
    </time>
  )
}

/**
 * The outcome of the last save of one field. Always rendered, empty when
 * there is nothing to say, because a live region has to exist before its
 * content changes for a screen reader to announce the change.
 */
function SaveState({ entry, t }) {
  return (
    <span className="cs-save" data-state={entry?.state ?? 'idle'} aria-live="polite">
      {entry?.state === 'saving'
        ? t('labelling.saving')
        : entry?.state === 'saved'
          ? t('labelling.saved')
          : entry?.state === 'failed'
            ? t('labelling.saveFailed', { message: entry.message })
            : ''}
    </span>
  )
}

/** An uploaded picture as a thumbnail that opens full size; anything else as a link. */
function FileLink({ file, label }) {
  return (
    <a className="cs-context-file" href={file.url} target="_blank" rel="noreferrer">
      {file.type?.startsWith('image/') ? <img src={file.url} alt={label} /> : (file.name ?? label)}
    </a>
  )
}

/**
 * A file only its annotator may fetch (`/api/research/snippets/:handle/files/:index`,
 * see server/routes/research.js). An `<img src>` cannot carry the bearer
 * token and the token never goes in a URL, so it is fetched with the token,
 * shown through an object URL, and the object URL is let go with the card.
 * If it cannot be loaded, `fallback` says what is missing instead.
 */
function PrivateFile({ file, label, fallback, t }) {
  const [loaded, setLoaded] = useState({ url: null, failed: false })

  useEffect(() => {
    let objectUrl = null
    let cancelled = false
    api
      .privateFile(file.url)
      .then((blob) => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setLoaded({ url: objectUrl, failed: false })
      })
      .catch(() => {
        if (!cancelled) setLoaded({ url: null, failed: true })
      })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [file.url])

  if (loaded.failed) return <p className="cs-hint">{fallback}</p>
  if (!loaded.url) return <p className="cs-hint">{t('labelling.loadingFile')}</p>
  return <FileLink file={{ ...file, url: loaded.url }} label={label} />
}

/** Behind a login (an annotator's copy) or not: the one place that decides. */
function ContextFile({ file, label, fallback, t }) {
  return file.url?.startsWith('/api/research/') ? (
    <PrivateFile file={file} label={label} fallback={fallback} t={t} />
  ) : (
    <FileLink file={file} label={label} />
  )
}

/**
 * What annotators made of a snippet, read-only, for an admin or a manager.
 *
 * An annotator's labels and reasons are their own entry on the server, kept
 * apart from the shared labels this card edits (see `annotationsOf` in
 * server/routes/research.js), so they are shown here beside them, attributed,
 * and never folded in. The current assignee's comes first; anyone the snippet
 * was assigned to before keeps theirs, marked as earlier. Nothing here is
 * editable, and the staff's own controls above are unchanged.
 */
function AnnotatorWork({ snippet, criteria, lang, t, nameOf }) {
  const entries = snippet.annotations ?? []
  const current = entries.find((entry) => entry.annotatorId === snippet.assigneeId) ?? null
  const ordered = [current, ...entries.filter((entry) => entry !== current)].filter(Boolean)
  if (!ordered.length && !snippet.assigneeId) return null

  return (
    <section className="cs-annot" aria-label={t('labelling.annotatorWorkHead')}>
      <p className="eyebrow cs-annot-head">{t('labelling.annotatorWorkHead')}</p>
      <p className="cs-hint cs-annot-hint">{t('labelling.annotatorWorkHint')}</p>
      {snippet.assigneeId && !current ? (
        <p className="cs-hint cs-annot-hint">
          {t('labelling.annotatorWorkNone', { name: nameOf(snippet) })}
        </p>
      ) : null}
      {ordered.map((entry) => (
        <div key={entry.annotatorId} className="cs-annot-entry" data-current={entry === current}>
          <p className="cs-annot-who">
            <strong>
              {t('labelling.annotatorWorkBy', {
                name: entry.annotatorName ?? t('labelling.unknownAnnotator'),
              })}
            </strong>{' '}
            <span className="cs-annot-tag">
              {entry === current ? t('labelling.annotatorWorkCurrent') : t('labelling.annotatorWorkEarlier')}
            </span>
            <When iso={entry.labelledAt} lang={lang} />
          </p>
          <dl className="cs-annot-list">
            {criteria.map((criterion) => {
              const value = entry.labels?.[criterion.id]
              const note = entry.notes?.[criterion.id]?.trim()
              return (
                <div key={criterion.id} className="cs-annot-row">
                  <dt className="cs-criterion-label">{criterion.label}</dt>
                  <dd className="cs-annot-value" data-value={value ?? 'none'}>
                    {value ? t(`labelling.${value}`) : t('labelling.annotatorWorkUnmarked')}
                  </dd>
                  {note ? <dd className="cs-annot-note cs-turn-text">{note}</dd> : null}
                </div>
              )
            })}
          </dl>
        </div>
      ))}
    </section>
  )
}

/**
 * What the student was working on, above the exchange: the question, and what
 * they handed in for it. A reply that reads as vague can be pointed for this
 * particular answer, and the labeller cannot tell without seeing both.
 */
function Context({ snippet, lang, t }) {
  const { question, answer } = snippet
  if (!question) return null

  const prompt = promptFor(question, lang)
  const board = answer?.attachments.find((file) => file.source === 'whiteboard')
  const photos = answer?.attachments.filter((file) => file.source !== 'whiteboard') ?? []

  return (
    <section className="cs-context">
      <div className="cs-tile-top">
        <p className="eyebrow" style={{ margin: 0 }}>
          {t('labelling.question')}{' '}
          {/* An annotator's copy has no code when the question had none to show. */}
          {question.code ? <span className="cs-q-code">{question.code}</span> : null}
        </p>
        {question.isOwnQuestion ? (
          <span className="cs-pill" data-tone="draft">
            {t('labelling.ownQuestion')}
          </span>
        ) : null}
      </div>

      <div className="cs-context-body">
        {prompt ? (
          <p className="cs-context-text">
            <MathText text={prompt} />
          </p>
        ) : null}
        {question.image ? (
          <ContextFile
            file={question.image}
            label={t('labelling.questionFile')}
            fallback={t('labelling.questionPhotoUnavailable')}
            t={t}
          />
        ) : null}
        {!prompt && !question.image ? <p className="cs-hint">{t('labelling.noPrompt')}</p> : null}
      </div>

      <p className="eyebrow cs-context-head">
        {t('labelling.theirAnswer')}
        <When iso={answer?.updatedAt} lang={lang} />
      </p>
      {answer ? (
        <div className="cs-context-body">
          {answer.draft?.trim() ? <p className="cs-context-text cs-turn-text">{answer.draft}</p> : null}
          {board ? (
            <ContextFile
              file={board}
              label={t('labelling.answerBoard')}
              fallback={t('labelling.answerFileUnavailable')}
              t={t}
            />
          ) : answer.strokeCount ? (
            <p className="cs-hint">
              {t('labelling.answerBoard')} · {t('common.strokes', { count: answer.strokeCount })}
            </p>
          ) : null}
          {photos.length ? (
            <div className="cs-context-files">
              {/* An annotator's files have no id, only their own URL. */}
              {photos.map((file) => (
                <ContextFile
                  key={file.id ?? file.url}
                  file={file}
                  label={t('labelling.answerPhoto')}
                  fallback={t('labelling.answerFileUnavailable')}
                  t={t}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <p className="cs-hint">{t('labelling.noAnswer')}</p>
      )}
    </section>
  )
}

/**
 * The labelling loop the study is actually for.
 *
 * A **snippet** is one thing the student said and the one reply that answered
 * it. Not every exchange is worth keeping, so there are two separate decisions
 * here and the screen keeps them apart:
 *
 * 1. **Keep or drop** — does this belong in the dataset at all? Only kept
 *    snippets are exported.
 * 2. **Label** — for a kept snippet, which of the criteria does the feedback
 *    meet: yes, partly, or no, each with its own free-text reason.
 *
 * Everything saves the moment it is pressed rather than behind a Save button.
 * Labelling is a long sitting of small judgements, and a lost batch because a
 * tab was closed is the failure mode that matters.
 *
 * One screen, three ways of holding it (server/routes/research.js):
 *
 * - **teacher** — their own classes' snippets, both decisions. An admin or
 *   their manager can switch a teacher's labelling off (`canLabel`); they are
 *   then told so here instead of being shown the server's refusal.
 * - **admin, manager** — the same, plus handing snippets to annotators: a
 *   checkbox per card, "select all shown", and a filter on who has them.
 * - **annotator** — only what has been assigned to them, under /annotate.
 *   They label, they do not keep or drop (the server refuses `included`), so
 *   the decision is shown to them read-only. Their `snippet.id` is an opaque
 *   handle rather than a snippet id, and their snippets carry no `sessionId`
 *   or `questionId`, so nothing here may build on those for them: a session id
 *   is what opens a student's session. Everything below keys on `snippet.id`
 *   alone, which works the same either way.
 */
export default function Labelling() {
  const { lang, t } = useI18n()
  const { user } = useAuth()
  const [params, setParams] = useSearchParams()

  const isAnnotator = user?.role === 'annotator'
  // Never sent for an annotator, who has no session ids: the server ignores the
  // filter for them, and the "one session" note would have nothing to say.
  const sessionId = isAnnotator ? '' : (params.get('session') ?? '')
  const canAssign = user?.role === 'admin' || user?.role === 'manager'
  const mayLabel = teacherCanLabel(user)

  // An annotator starts from everything assigned: "not yet decided" is the
  // staff's keep-or-drop queue, which is not theirs to work through.
  const filter = params.get('show') ?? (isAnnotator ? 'all' : 'undecided')
  /** Client-side, over what was loaded: `all`, `none`, or an annotator's id. */
  const assigneeFilter = params.get('assignee') ?? 'all'

  const fetchList = () =>
    api.snippets({ sessionId, included: filter === 'all' ? undefined : filter })

  // Not requested at all when labelling is off: the answer is known to be a 403.
  const { data, error, loading, setData } = useAsync(
    () => (mayLabel ? fetchList() : Promise.resolve(null)),
    [sessionId, filter, mayLabel],
  )

  // Only the people who assign may list annotators; nobody else asks.
  const annotators = useAsync(
    () => (canAssign ? api.annotators() : Promise.resolve({ annotators: [] })),
    [canAssign],
  )
  const annotatorList = annotators.data?.annotators ?? []

  /** Ids ticked for assignment. Acted on only where they are also shown. */
  const [selected, setSelected] = useState(() => new Set())
  const [assignTo, setAssignTo] = useState('')
  /** { state: saving | saved | failed, text } — the last assignment's outcome. */
  const [assignState, setAssignState] = useState(null)

  /** `${snippetId}|${field}` -> { state: saving | saved | failed, message, token } */
  const [status, setStatus] = useState({})

  /**
   * The list as last confirmed, readable from inside a queued save. A save
   * that builds its body from the render it was clicked in would send the
   * labels as they stood before an earlier, still-running save landed.
   */
  const latest = useRef(null)
  /** The list request as of the last render, for a re-read started from a save. */
  const fetchLatest = useRef(fetchList)
  useEffect(() => {
    latest.current = data
    fetchLatest.current = fetchList
  })

  /** One chain of saves per snippet, so its writes reach the server in order. */
  const queues = useRef(new Map())

  /** Shown after a save found its snippet gone and the list was re-read. */
  const [goneNotice, setGoneNotice] = useState(false)
  /** The re-read in flight, so several saves on a gone snippet start one. */
  const refreshing = useRef(null)

  /**
   * An annotator's save answered 404: that handle no longer resolves. The
   * snippet was taken back from them, its session was withdrawn, or the
   * server's handle key changed and every handle on the page is stale. Each
   * of those is fixed by reading the list again, not by retrying.
   *
   * Re-read quietly — no loading state, so no card is unmounted and nothing
   * typed into another card's box is lost — and only once every save already
   * queued has finished, so the list read back includes them rather than
   * racing them. Not awaited by the save that called it: that save is one of
   * the ones being waited for.
   */
  const refreshAfterGone = () => {
    setGoneNotice(true)
    if (refreshing.current) return
    refreshing.current = (async () => {
      await Promise.all([...queues.current.values()])
      try {
        const fresh = await fetchLatest.current()
        latest.current = fresh
        setData(fresh)
      } catch {
        // The notice stands, and the next save will say what went wrong.
      } finally {
        refreshing.current = null
      }
    })()
  }

  const snippets = data?.snippets ?? []
  const criteria = data?.criteria ?? []

  const shown = canAssign
    ? snippets.filter((snippet) =>
        assigneeFilter === 'all'
          ? true
          : assigneeFilter === 'none'
            ? !snippet.assigneeId
            : snippet.assigneeId === assigneeFilter,
      )
    : snippets
  const selectedShown = shown.filter((snippet) => selected.has(snippet.id))

  /**
   * Assignees on the loaded snippets who are not in the picker's list, which
   * holds active annotators only — in practice, deactivated ones whose work
   * is still assigned to them. Offered in the "Assigned to" filter all the
   * same, marked as deactivated, so that work can be found and handed on.
   */
  const stragglers = canAssign
    ? [
        ...new Map(
          snippets
            .filter(
              (snippet) =>
                snippet.assigneeId && !annotatorList.some((entry) => entry.id === snippet.assigneeId),
            )
            .map((snippet) => [snippet.assigneeId, snippet]),
        ).values(),
      ]
    : []
  /** An assignee's name as staff read it, flagged when the account is deactivated. */
  const assigneeLabel = (snippet) => {
    const name = snippet.assigneeName ?? t('labelling.unknownAnnotator')
    // No name means no annotator account at all: "a removed annotator" says that already.
    return snippet.assigneeActive === false && snippet.assigneeName
      ? t('labelling.deactivatedName', { name })
      : name
  }
  const allShownSelected = shown.length > 0 && selectedShown.length === shown.length

  const setParam = (name, value, fallback) => {
    const next = new URLSearchParams(params)
    if (value === fallback) next.delete(name)
    else next.set(name, value)
    setParams(next, { replace: true })
  }

  const toggle = (snippetId) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(snippetId)) next.delete(snippetId)
      else next.add(snippetId)
      return next
    })

  const toggleAllShown = () =>
    setSelected((prev) => {
      const next = new Set(prev)
      for (const snippet of shown) {
        if (allShownSelected) next.delete(snippet.id)
        else next.add(snippet.id)
      }
      return next
    })

  /**
   * Hands the ticked, shown snippets to one annotator, or takes them back
   * (`assigneeId: null`). The server does all or nothing, so the rows are
   * patched only on success, and a failure leaves both list and selection as
   * they were for another try.
   */
  const assign = async (assigneeId) => {
    const ids = selectedShown.map((snippet) => snippet.id)
    if (!ids.length) return
    const assignee = assigneeId ? annotatorList.find((entry) => entry.id === assigneeId) : null

    setAssignState({ state: 'saving', text: t('labelling.assigning') })
    try {
      const result = await api.assignSnippets(ids, assigneeId)
      const moved = new Set(result.snippetIds)
      const at = new Date().toISOString()
      setData(
        (prev) =>
          prev && {
            ...prev,
            snippets: prev.snippets.map((row) =>
              moved.has(row.id)
                ? {
                    ...row,
                    assigneeId,
                    assigneeName: assignee?.name ?? null,
                    assigneeActive: assigneeId ? true : null,
                    assignedBy: assigneeId ? user.id : null,
                    assignedAt: assigneeId ? at : null,
                  }
                : row,
            ),
          },
      )
      setSelected(new Set())
      setAssignState({
        state: 'saved',
        text: assigneeId
          ? t('labelling.assignedDone', { count: result.count, name: assignee?.name ?? '' })
          : t('labelling.unassignedDone', { count: result.count }),
      })
    } catch (failure) {
      setAssignState({ state: 'failed', text: t('labelling.assignFailed', { message: failure.message }) })
    }
  }

  /**
   * Patches the row in place rather than refetching.
   *
   * A refetch under the "undecided" filter would make the row vanish the
   * instant it was decided, taking the criteria half of the job with it — so
   * the list is only re-read when the filter itself changes.
   *
   * `makePatch` is given the row as it stands when the save actually runs,
   * after any earlier save of the same snippet has finished. Nothing is
   * disabled while a save is in flight: a box being typed in must not lose its
   * focus, and a press made while another save runs is queued, not dropped.
   */
  const save = (snippetId, field, makePatch) => {
    const key = `${snippetId}|${field}`
    const token = {}
    const mine = (prev) => prev[key]?.token === token
    setStatus((prev) => ({ ...prev, [key]: { state: 'saving', token } }))

    const run = async () => {
      // Missing only if the filter changed and the list was re-read meanwhile;
      // the save still goes ahead, and `makePatch` falls back to what it saw.
      const entry = latest.current?.snippets.find((row) => row.id === snippetId) ?? null

      try {
        const { label } = await api.labelSnippet(snippetId, makePatch(entry))
        const merge = (row) => ({
          ...row,
          included: label.included ?? row.included,
          labels: label.labels ?? row.labels,
          note: label.note ?? row.note,
          notes: label.notes ?? row.notes,
        })
        const apply = (prev) =>
          prev && {
            ...prev,
            snippets: prev.snippets.map((row) => (row.id === snippetId ? merge(row) : row)),
          }
        // Written here as well as through setData: the next queued save can
        // start before React has rendered this one.
        latest.current = apply(latest.current)
        setData(apply)

        setStatus((prev) => (mine(prev) ? { ...prev, [key]: { state: 'saved', token } } : prev))
        setTimeout(() => {
          setStatus((prev) => {
            if (!mine(prev) || prev[key].state !== 'saved') return prev
            const next = { ...prev }
            delete next[key]
            return next
          })
        }, SAVED_FOR_MS)
      } catch (failure) {
        if (isAnnotator && failure.status === 404) refreshAfterGone()
        setStatus((prev) =>
          mine(prev) ? { ...prev, [key]: { state: 'failed', message: failure.message, token } } : prev,
        )
      }
    }

    const tail = (queues.current.get(snippetId) ?? Promise.resolve()).then(run)
    queues.current.set(snippetId, tail)
  }

  return (
    <>
      <header className="cs-head">
        <div>
          <p className="eyebrow">{t('labelling.eyebrow')}</p>
          <h1 className="cs-title">{t('labelling.title')}</h1>
          {/* No description of work that is switched off; the note below says why. */}
          {mayLabel ? (
            <p className="cs-lede">
              {isAnnotator ? t('labelling.ledeAnnotator') : t('labelling.lede')}
            </p>
          ) : null}
        </div>

        {mayLabel ? (
          <div className="cs-field">
            <label className="cs-label" htmlFor="show">
              {t('labelling.show')}
            </label>
            <select
              id="show"
              className="cs-select"
              value={filter}
              onChange={(event) => {
                const next = new URLSearchParams(params)
                next.set('show', event.target.value)
                setParams(next, { replace: true })
              }}
            >
              <option value="undecided">{t('labelling.filterUndecided')}</option>
              <option value="true">{t('labelling.filterKept')}</option>
              <option value="false">{t('labelling.filterDropped')}</option>
              <option value="all">{t('labelling.filterAll')}</option>
            </select>
          </div>
        ) : null}
      </header>

      {/* Said plainly, with no request made: the server would answer 403. */}
      {!mayLabel ? (
        <p className="cs-note" data-tone="warn" role="status">
          {t('labelling.turnedOff')}
        </p>
      ) : null}

      {goneNotice ? (
        <p className="cs-note" data-tone="warn" role="status">
          {t('labelling.listRefreshed')}{' '}
          <button type="button" className="cs-btn cs-btn-sm" onClick={() => setGoneNotice(false)}>
            {t('labelling.dismiss')}
          </button>
        </p>
      ) : null}

      {sessionId ? (
        <p className="cs-note">
          {t('labelling.oneSession')}{' '}
          <button
            type="button"
            className="cs-btn cs-btn-sm"
            onClick={() => {
              const next = new URLSearchParams(params)
              next.delete('session')
              setParams(next, { replace: true })
            }}
          >
            {t('labelling.showAll')}
          </button>
        </p>
      ) : null}

      {canAssign && mayLabel && !error && !loading ? (
        <section className="cs-card cs-assign" aria-label={t('labelling.assignHead')}>
          <div className="cs-assign-row">
            <div className="cs-field">
              <label className="cs-label" htmlFor="assignee-filter">
                {t('labelling.assignedTo')}
              </label>
              <select
                id="assignee-filter"
                className="cs-select"
                value={assigneeFilter}
                onChange={(event) => setParam('assignee', event.target.value, 'all')}
              >
                <option value="all">{t('labelling.assigneeAll')}</option>
                <option value="none">{t('labelling.assigneeNone')}</option>
                {annotatorList.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
                {stragglers.map((snippet) => (
                  <option key={snippet.assigneeId} value={snippet.assigneeId}>
                    {assigneeLabel(snippet)}
                  </option>
                ))}
              </select>
            </div>

            <label className="cs-check cs-assign-all">
              <input
                type="checkbox"
                checked={allShownSelected}
                disabled={shown.length === 0}
                ref={(node) => {
                  // "Some" is a third state a checkbox can only show from script.
                  if (node) node.indeterminate = selectedShown.length > 0 && !allShownSelected
                }}
                onChange={toggleAllShown}
              />
              <span>
                {t('labelling.selectAllShown', { count: shown.length })}
                <span className="cs-hint">
                  {' · '}
                  {t('labelling.selectedCount', { count: selectedShown.length })}
                </span>
              </span>
            </label>
          </div>

          {annotators.error ? (
            <p className="cs-note" data-tone="bad" role="alert">
              {annotators.error.message}
            </p>
          ) : annotatorList.length === 0 && !annotators.loading ? (
            <p className="cs-note">
              {t('labelling.noAnnotators')}{' '}
              {user.role === 'admin' ? (
                <Link to="/admin">{t('labelling.noAnnotatorsAdmin')}</Link>
              ) : (
                t('labelling.noAnnotatorsManager')
              )}
            </p>
          ) : (
            <div className="cs-assign-row">
              <div className="cs-field">
                <label className="cs-label" htmlFor="assign-to">
                  {t('labelling.assignTo')}
                </label>
                <select
                  id="assign-to"
                  className="cs-select"
                  value={assignTo}
                  onChange={(event) => setAssignTo(event.target.value)}
                >
                  <option value="">{t('labelling.pickAnnotator')}</option>
                  {annotatorList.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="cs-actions">
                <button
                  type="button"
                  className="cs-btn cs-btn-sm cs-btn-primary"
                  disabled={!assignTo || selectedShown.length === 0 || assignState?.state === 'saving'}
                  onClick={() => assign(assignTo)}
                >
                  {t('labelling.assignSelected', { count: selectedShown.length })}
                </button>
                <button
                  type="button"
                  className="cs-btn cs-btn-sm"
                  disabled={selectedShown.length === 0 || assignState?.state === 'saving'}
                  onClick={() => assign(null)}
                >
                  {t('labelling.unassignSelected', { count: selectedShown.length })}
                </button>
              </div>
            </div>
          )}

          {/* Always rendered so the outcome is announced when it arrives. */}
          <p className="cs-assign-state" aria-live="polite">
            {assignState ? (
              <span className="cs-save" data-state={assignState.state}>
                {assignState.text}
              </span>
            ) : null}
          </p>
        </section>
      ) : null}

      {!mayLabel ? null : error ? (
        <p className="cs-note" data-tone="bad">
          {error.message}
        </p>
      ) : loading ? (
        <p className="cs-note">{t('common.loading')}</p>
      ) : shown.length === 0 ? (
        <p className="cs-empty">
          {isAnnotator && snippets.length === 0 && filter === 'all' && !sessionId
            ? t('labelling.emptyAnnotator')
            : filter === 'undecided' && !isAnnotator && snippets.length === 0
              ? t('labelling.emptyUndecided')
              : t('labelling.emptyOther')}
        </p>
      ) : (
        <div style={{ display: 'grid', gap: 'var(--s-5)', marginTop: 'var(--s-4)' }}>
          {shown.map((snippet) => {
            const decision =
              snippet.included === true ? 'kept' : snippet.included === false ? 'dropped' : 'none'
            const decisionStatus = status[`${snippet.id}|included`]

            return (
              <article key={snippet.id} className="cs-snip">
                {canAssign ? (
                  <div className="cs-snip-assign">
                    <label className="cs-check">
                      <input
                        type="checkbox"
                        checked={selected.has(snippet.id)}
                        onChange={() => toggle(snippet.id)}
                      />
                      <span>{t('labelling.select')}</span>
                    </label>
                    <span className="cs-pill" data-tone={snippet.assigneeId ? 'live' : 'quiet'}>
                      {snippet.assigneeId
                        ? t('labelling.assignedToName', { name: assigneeLabel(snippet) })
                        : t('labelling.notAssigned')}
                    </span>
                  </div>
                ) : null}

                <div>
                  <Context snippet={snippet} lang={lang} t={t} />

                  <div className="cs-turn" data-from="student">
                    <p className="cs-turn-who eyebrow">
                      {t('labelling.studentAsked')}
                      <When iso={snippet.student.at} lang={lang} />
                    </p>
                    <p className="cs-turn-text">{snippet.student.text}</p>
                  </div>

                  <div className="cs-turn" data-from="tutor">
                    <p className="cs-turn-who eyebrow">
                      {snippet.tutor.label ?? t('labelling.feedback')}
                      {snippet.rating
                        ? ` · ${t('labelling.studentRated', { rating: snippet.rating })}`
                        : ''}
                      <When iso={snippet.tutor.at} lang={lang} />
                    </p>
                    <p className="cs-turn-text">{snippet.tutor.text}</p>
                  </div>

                  <div className="cs-decision">
                    {/* Keep-or-drop is staff's: an annotator sees where it stands. */}
                    {isAnnotator ? null : (
                      <div className="cs-actions">
                        <button
                          type="button"
                          className={`cs-btn cs-btn-sm cs-decide ${snippet.included === true ? 'cs-btn-primary' : ''}`}
                          data-kind="keep"
                          aria-pressed={snippet.included === true}
                          onClick={() => save(snippet.id, 'included', () => ({ included: true }))}
                        >
                          {snippet.included === true ? '✓ ' : ''}
                          {t('labelling.keep')}
                        </button>
                        <button
                          type="button"
                          className={`cs-btn cs-btn-sm cs-decide ${snippet.included === false ? 'cs-btn-danger' : ''}`}
                          data-kind="drop"
                          aria-pressed={snippet.included === false}
                          onClick={() => save(snippet.id, 'included', () => ({ included: false }))}
                        >
                          {snippet.included === false ? '✓ ' : ''}
                          {t('labelling.drop')}
                        </button>
                      </div>
                    )}

                    {/* The standing decision and the save that changed it, read
                        out together so a press is never met with silence. */}
                    <p className="cs-decision-state" data-decision={decision} aria-live="polite">
                      <span>
                        {decision === 'kept'
                          ? t('labelling.decisionKept')
                          : decision === 'dropped'
                            ? t('labelling.decisionDropped')
                            : t('labelling.decisionNone')}
                      </span>
                      {decisionStatus ? (
                        <span className="cs-save" data-state={decisionStatus.state}>
                          {decisionStatus.state === 'saving'
                            ? t('labelling.saving')
                            : decisionStatus.state === 'saved'
                              ? t('labelling.saved')
                              : t('labelling.saveFailed', { message: decisionStatus.message })}
                        </span>
                      ) : null}
                    </p>
                  </div>
                </div>

                <div>
                  <p className="eyebrow" style={{ marginBottom: 'var(--s-2)' }}>
                    {t('labelling.criteriaHead')}
                  </p>

                  <div className="cs-criteria">
                    {criteria.map((criterion) => {
                      const noteId = `note-${snippet.id}-${criterion.id}`
                      const saved = snippet.notes?.[criterion.id] ?? ''

                      return (
                        <div key={criterion.id} className="cs-criterion">
                          <div className="cs-criterion-head">
                            <span className="cs-criterion-label">{criterion.label}</span>
                            <SaveState entry={status[`${snippet.id}|label:${criterion.id}`]} t={t} />
                          </div>
                          <div className="cs-choices">
                            {VALUES.map((value) => (
                              <button
                                key={value}
                                type="button"
                                className="cs-choice"
                                aria-pressed={snippet.labels?.[criterion.id] === value}
                                onClick={() =>
                                  save(snippet.id, `label:${criterion.id}`, (entry) => ({
                                    labels: { ...(entry ?? snippet).labels, [criterion.id]: value },
                                  }))
                                }
                              >
                                {t(`labelling.${value}`)}
                              </button>
                            ))}
                          </div>

                          <div className="cs-field">
                            <div className="cs-criterion-head">
                              <label className="cs-label" htmlFor={noteId}>
                                {t('labelling.why')}
                              </label>
                              <SaveState entry={status[`${snippet.id}|note:${criterion.id}`]} t={t} />
                            </div>
                            <textarea
                              id={noteId}
                              className="cs-textarea"
                              rows={2}
                              defaultValue={saved}
                              placeholder={t('labelling.whyCriterionPlaceholder')}
                              // Saved on blur rather than per keystroke: one row is a
                              // paragraph at most, and a request per character would
                              // make the whole list feel broken. Only this criterion
                              // is sent; the server folds it into the others.
                              onBlur={(event) => {
                                const text = event.target.value
                                if (text !== saved) {
                                  save(snippet.id, `note:${criterion.id}`, () => ({
                                    notes: { [criterion.id]: text },
                                  }))
                                }
                              }}
                            />
                          </div>
                        </div>
                      )
                    })}

                    {/* The single reason the screen asked for before each
                        criterion had one. Shown, not offered: new labelling
                        goes per criterion, and this stays as it was written. */}
                    {snippet.note?.trim() ? (
                      <div className="cs-earlier-note">
                        <p className="eyebrow" style={{ margin: 0 }}>
                          {t('labelling.earlierNote')}
                        </p>
                        <p className="cs-turn-text">{snippet.note}</p>
                        <p className="cs-hint">{t('labelling.earlierNoteHint')}</p>
                      </div>
                    ) : null}
                  </div>
                </div>

                {canAssign ? (
                  <AnnotatorWork
                    snippet={snippet}
                    criteria={criteria}
                    lang={lang}
                    t={t}
                    nameOf={assigneeLabel}
                  />
                ) : null}
              </article>
            )
          })}
        </div>
      )}
    </>
  )
}
