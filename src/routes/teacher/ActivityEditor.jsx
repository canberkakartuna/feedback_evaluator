import { useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { LIMITS, PROMPT_LANGS, TOPICS, isMathTools, promptFor, titleFor } from '../../../shared/activity'
import AvailabilityNote from '../../components/AvailabilityNote'
import BilingualField from '../../components/BilingualField'
import MathText from '../../components/MathText'
import { api } from '../../lib/api'
import { fromInputToIso, isSavableDay, isoToInput, liveState, untilInputToIso } from '../../lib/availability'
import { useI18n } from '../../lib/i18n'
import { useAsync } from '../../lib/useAsync'
import { initialNames } from '../../lib/wording'
import QuestionForm from './QuestionForm'
import ShareActivity from './ShareActivity'
import TutorGuidance from './TutorGuidance'

/**
 * The activity's name in both languages, with a Save that appears once either
 * box differs from what is stored. Keyed by `updatedAt` where it is used, so
 * a save (or any other change that reloads the activity) starts it afresh
 * from what the server kept.
 */
function ActivityName({ activity, busy, onSave }) {
  const { lang, t } = useI18n()
  // Fixed at mount, so flipping the EN/TR switch cannot make an untouched
  // older name look edited — see initialByLang on where a lone `title` goes.
  const [stored] = useState(() => initialNames(activity, lang))
  const [names, setNames] = useState(stored)

  const changed = PROMPT_LANGS.some((code) => names[code].trim() !== stored[code].trim())
  const named = Boolean(names.en.trim() || names.tr.trim())

  return (
    <div className="cs-form" style={{ marginTop: 'var(--s-4)' }}>
      <BilingualField
        id="activity-name"
        label={t('editor.nameLabel')}
        hint={t('activities.titleHint')}
        maxLength={LIMITS.title}
        disabled={busy}
        values={names}
        onChange={(code, text) => setNames((prior) => ({ ...prior, [code]: text }))}
      />
      {changed ? (
        <div className="cs-actions">
          <button
            type="button"
            className="cs-btn cs-btn-primary cs-btn-sm"
            disabled={busy || !named}
            onClick={() => onSave({ titleByLang: names })}
          >
            {busy ? t('common.saving') : t('editor.saveName')}
          </button>
          <button type="button" className="cs-btn cs-btn-sm" onClick={() => setNames(stored)}>
            {t('common.cancel')}
          </button>
        </div>
      ) : null}
    </div>
  )
}

/** The pill/eyebrow word for each liveState — see src/lib/availability.js. */
const LIVE_LABEL = {
  draft: 'activities.draft',
  open: 'activities.open',
  upcoming: 'activities.scheduled',
  ended: 'activities.ended',
}

/**
 * One end of the availability range: a native date input and, once a date is
 * stored, a Clear button. Keyed by the stored value where it is used, so a
 * reload after saving starts it afresh from what the server kept.
 *
 * - **Saved as soon as it is a whole day** — on change, on Enter, and on blur
 *   as a backstop. "Whole" is isSavableDay: typing a year digit by digit makes
 *   some browsers report 0002, 0020, 0202 on the way to 2026, and those are
 *   never sent.
 * - **Never cleared by an empty box.** Deleting one part of the date empties
 *   the value in Chrome; leaving the box then puts the stored date back rather
 *   than opening the activity indefinitely. Clearing is the button, only.
 * - **A refused save puts the stored date back**, so the box never shows a
 *   date the server did not keep (the reason is in the notice above).
 * - **One save per value.** Change and blur can both fire for the same pick;
 *   the value in flight is not sent again, and only the latest save may reset
 *   the box when it fails.
 */
function DateField({ id, label, hint, clearLabel, stored, toIso, min, max, busy, onSave }) {
  const { t } = useI18n()
  const storedValue = isoToInput(stored)
  const [value, setValue] = useState(storedValue)
  const inFlight = useRef(null)
  const latest = useRef(0)

  const save = (candidate) => {
    if (candidate === storedValue || candidate === inFlight.current) return
    const attempt = ++latest.current
    inFlight.current = candidate
    onSave(candidate === '' ? null : toIso(candidate))
      .catch(() => {
        if (attempt === latest.current) setValue(storedValue)
      })
      .finally(() => {
        if (attempt === latest.current) inFlight.current = null
      })
  }

  const saveIfWhole = (candidate) => {
    if (isSavableDay(candidate)) save(candidate)
  }

  return (
    // alignContent: a longer hint beside it must not stretch this box taller.
    <div className="cs-field" style={{ maxWidth: '320px', alignContent: 'start' }}>
      <label className="cs-label" htmlFor={id}>
        {label}
      </label>
      <div style={{ display: 'flex', gap: 'var(--s-2)', alignItems: 'center' }}>
        <input
          id={id}
          type="date"
          className="cs-input"
          disabled={busy}
          min={min || undefined}
          max={max || undefined}
          value={value}
          onChange={(event) => {
            setValue(event.target.value)
            saveIfWhole(event.target.value)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              saveIfWhole(value)
            }
          }}
          onBlur={() => {
            if (isSavableDay(value)) save(value)
            else if (!inFlight.current) setValue(storedValue)
          }}
        />
        {stored ? (
          <button
            type="button"
            className="cs-btn cs-btn-sm"
            disabled={busy}
            aria-label={clearLabel}
            onClick={() => save('')}
          >
            {t('editor.clearDate')}
          </button>
        ) : null}
      </div>
      <p className="cs-hint">{hint}</p>
    </div>
  )
}

/**
 * One activity: its settings, how students reach it, and its questions.
 *
 * Publishing is the hinge and the whole access decision — a draft is invisible
 * to students and cannot be started, by id or by class code, so a teacher can
 * build at their own pace. The server refuses to publish an activity with no
 * questions. Unpublishing closes it again without touching anything already
 * recorded, which is why it is offered as the answer whenever a delete is
 * refused.
 */
export default function ActivityEditor() {
  const { activityId } = useParams()
  const navigate = useNavigate()
  const { lang, t } = useI18n()

  const { data, error, loading, reload } = useAsync(
    () => api.activity(activityId),
    [activityId],
  )

  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)

  if (loading) return <p className="cs-note">{t('common.loading')}</p>
  if (error) {
    return (
      <p className="cs-note" data-tone="bad">
        {error.message} — <Link to="/teacher">{t('editor.breadcrumb')}</Link>
      </p>
    )
  }

  const { activity, questions } = data
  const published = activity.status === 'published'
  // Published but outside its dates is closed to students — the explainer
  // below must not call that open. Draft still comes first.
  const live = liveState(activity)
  const availableFrom = activity.availableFrom ?? null
  const availableUntil = activity.availableUntil ?? null

  const act = async (work) => {
    setBusy(true)
    setNotice(null)
    try {
      await work()
      await reload()
    } catch (failure) {
      // The one refusal said in the teacher's language; every other as the server put it.
      const text =
        failure.details?.code === 'availability_range_invalid'
          ? t('editor.rangeInvalid')
          : failure.message
      setNotice({ tone: 'bad', text })
      throw failure
    } finally {
      setBusy(false)
    }
  }

  const move = (index, delta) => {
    const next = [...questions]
    const target = index + delta
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    return act(() => api.reorderQuestions(activity.id, next.map((question) => question.id)))
  }

  const remove = async () => {
    try {
      await api.deleteActivity(activity.id)
      navigate('/teacher', { replace: true })
    } catch (failure) {
      setNotice({
        tone: 'warn',
        text: `${failure.message}. ${failure.details?.hint ?? ''}`,
      })
    }
  }

  return (
    <>
      <header className="cs-head">
        <div>
          <p className="eyebrow">
            <Link to="/teacher">{t('editor.breadcrumb')}</Link> ·{' '}
            {t(LIVE_LABEL[live])}
          </p>
          <h1 className="cs-title">{titleFor(activity, lang)}</h1>
          {activity.blurb ? <p className="cs-lede">{activity.blurb}</p> : null}
        </div>

        <div className="cs-actions">
          <Link className="cs-btn" to={`/teacher/students?activity=${activity.id}`}>
            {t('editor.seeWork')}
          </Link>
          <button
            type="button"
            className={`cs-btn ${published ? '' : 'cs-btn-primary'}`}
            disabled={busy || (!published && questions.length === 0)}
            onClick={() =>
              act(() =>
                api.updateActivity(activity.id, {
                  status: published ? 'draft' : 'published',
                }),
              ).catch(() => {})
            }
          >
            {published ? t('editor.closeToStudents') : t('editor.publish')}
          </button>
        </div>
      </header>

      {notice ? (
        <p className="cs-note" data-tone={notice.tone} role="alert">
          {notice.text}
        </p>
      ) : null}

      <section className="cs-card">
        {live === 'upcoming' || live === 'ended' ? (
          <>
            <p className="eyebrow">
              {live === 'upcoming' ? t('editor.scheduledHead') : t('editor.endedHead')}
            </p>
            <p className="cs-hint" style={{ marginTop: 'var(--s-1)' }}>
              {live === 'upcoming' ? t('editor.scheduledHint') : t('editor.endedHint')}
            </p>
          </>
        ) : published ? (
          <>
            <p className="eyebrow">{t('editor.openHead')}</p>
            <p className="cs-hint" style={{ marginTop: 'var(--s-1)' }}>
              {t('editor.openHint')}
            </p>
          </>
        ) : (
          <>
            <p className="eyebrow">{t('editor.draftHead')}</p>
            <p className="cs-hint" style={{ marginTop: 'var(--s-1)' }}>
              {questions.length === 0 ? t('editor.draftHintEmpty') : t('editor.draftHint')}
            </p>
          </>
        )}

        <ActivityName
          key={activity.updatedAt}
          activity={activity}
          busy={busy}
          onSave={(patch) => act(() => api.updateActivity(activity.id, patch)).catch(() => {})}
        />

        {/* The topic, saved on change rather than behind a Save button: it is one
            field, and the list a class reads is filtered by it. */}
        <div className="cs-row" style={{ marginTop: 'var(--s-4)' }}>
        <div className="cs-field" style={{ maxWidth: '320px' }}>
          <label className="cs-label" htmlFor="activity-topic">
            {t('editor.topicLabel')}
          </label>
          <select
            id="activity-topic"
            className="cs-select"
            disabled={busy}
            value={activity.topic ?? ''}
            onChange={(event) =>
              act(() =>
                api.updateActivity(activity.id, { topic: event.target.value || null }),
              ).catch(() => {})
            }
          >
            <option value="">{t('topics.unset')}</option>
            {TOPICS.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {t(`topics.${entry.id}`)}
              </option>
            ))}
          </select>
          <p className="cs-hint">{busy ? t('editor.topicSaving') : t('editor.topicHint')}</p>
        </div>

        {/* Saved when the field loses focus, so a teacher typing "9. sınıf" is
            not sending a request per keystroke. Keyed by the stored value so a
            reload after saving shows what the server kept. */}
        <div className="cs-field" style={{ maxWidth: '320px' }}>
          <label className="cs-label" htmlFor="activity-level">
            {t('activities.levelLabel')}
          </label>
          <input
            key={activity.level ?? ''}
            id="activity-level"
            className="cs-input"
            disabled={busy}
            maxLength={LIMITS.level}
            placeholder={t('activities.levelPlaceholder')}
            defaultValue={activity.level ?? ''}
            onBlur={(event) => {
              const next = event.target.value.trim()
              if (next === (activity.level ?? '')) return
              act(() => api.updateActivity(activity.id, { level: next })).catch(() => {})
            }}
          />
          <p className="cs-hint">{t('activities.levelHint')}</p>
        </div>

        {/* Where the maths row over the student's answer and chat boxes starts —
            MATH_TOOLS in shared/activity.js. Saved on change, like the topic. */}
        <div className="cs-field" style={{ maxWidth: '320px' }}>
          <label className="cs-label" htmlFor="activity-math-tools">
            {t('editor.mathToolsLabel')}
          </label>
          <select
            id="activity-math-tools"
            className="cs-select"
            disabled={busy}
            value={isMathTools(activity.mathTools) ? activity.mathTools : 'auto'}
            onChange={(event) =>
              act(() => api.updateActivity(activity.id, { mathTools: event.target.value })).catch(() => {})
            }
          >
            <option value="auto">{t('editor.mathToolsAuto')}</option>
            <option value="open">{t('editor.mathToolsOpen')}</option>
            <option value="closed">{t('editor.mathToolsClosed')}</option>
          </select>
          <p className="cs-hint">{t('editor.mathToolsHint')}</p>
        </div>
        </div>

        {/* When a published activity is open — availabilityState in
            shared/activity.js. Each end saves on its own; the server refuses
            an end before the start, and that refusal shows in the notice above. */}
        <div className="cs-row" style={{ marginTop: 'var(--s-4)' }}>
          <DateField
            key={`from-${availableFrom ?? ''}`}
            id="activity-available-from"
            label={t('editor.availableFromLabel')}
            hint={t('editor.availableFromHint')}
            clearLabel={t('editor.clearFromLabel')}
            stored={availableFrom}
            toIso={fromInputToIso}
            max={isoToInput(availableUntil)}
            busy={busy}
            onSave={(next) => act(() => api.updateActivity(activity.id, { availableFrom: next }))}
          />
          <DateField
            key={`until-${availableUntil ?? ''}`}
            id="activity-available-until"
            label={t('editor.availableUntilLabel')}
            hint={t('editor.availableUntilHint')}
            clearLabel={t('editor.clearUntilLabel')}
            stored={availableUntil}
            toIso={untilInputToIso}
            min={isoToInput(availableFrom)}
            busy={busy}
            onSave={(next) => act(() => api.updateActivity(activity.id, { availableUntil: next }))}
          />
        </div>
        {/* AVAILABILITY_TIME_ZONE: a teacher abroad picks days in Turkey time. */}
        <p className="cs-hint" style={{ marginTop: 'var(--s-2)', marginBottom: 0 }}>
          {t('editor.availabilityZoneHint')}
        </p>
        <AvailabilityNote activity={activity} audience="teacher" style={{ marginTop: 'var(--s-3)' }} />

        <TutorGuidance
          key={activity.tutorPrompt ?? ''}
          activity={activity}
          busy={busy}
          onSave={(patch) => act(() => api.updateActivity(activity.id, patch)).catch(() => {})}
        />
      </section>

      <ShareActivity activity={activity} published={published} />

      <section className="cs-section">
        <div className="cs-head">
          <h2 className="cs-section-head" style={{ margin: 0 }}>
            {t('editor.questions')} <span className="mono cs-hint">({questions.length})</span>
          </h2>
          {!adding ? (
            <button
              type="button"
              className="cs-btn cs-btn-primary"
              onClick={() => {
                setAdding(true)
                setEditingId(null)
              }}
            >
              {t('editor.addQuestion')}
            </button>
          ) : null}
        </div>

        {adding ? (
          <div className="cs-card" style={{ marginBottom: 'var(--s-4)' }}>
            <h3 className="cs-section-head">{t('editor.newQuestion')}</h3>
            <QuestionForm
              busy={busy}
              onCancel={() => setAdding(false)}
              onSave={async (body) => {
                await act(() => api.addQuestion(activity.id, body))
                setAdding(false)
              }}
            />
          </div>
        ) : null}

        {questions.length === 0 && !adding ? (
          <p className="cs-empty">{t('editor.noQuestions')}</p>
        ) : (
          <ul className="cs-qlist">
            {questions.map((question, index) => (
              <li key={question.id} className="cs-q">
                <div className="cs-q-head">
                  <span className="cs-q-code">{question.code}</span>
                  <p className="cs-q-prompt">
                    {promptFor(question, lang) ? (
                      <MathText text={promptFor(question, lang)} />
                    ) : (
                      <em>{t('editor.uploadedNoText')}</em>
                    )}
                  </p>

                  {question.image ? (
                    <span className="cs-pill" data-tone="draft">
                      {t('editor.picture')}
                    </span>
                  ) : null}

                  {/* Only when there is one. New questions have no mark
                      scheme, so "unmarked" on every row would be noise. */}
                  {question.rubric?.length ? (
                    <span className="cs-pill" data-tone="live">
                      {t('common.criteria', { count: question.rubric.length })}
                    </span>
                  ) : null}

                  <button
                    type="button"
                    className="cs-btn cs-btn-sm"
                    disabled={busy || index === 0}
                    aria-label={t('editor.moveUp', { code: question.code })}
                    onClick={() => move(index, -1)?.catch(() => {})}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="cs-btn cs-btn-sm"
                    disabled={busy || index === questions.length - 1}
                    aria-label={t('editor.moveDown', { code: question.code })}
                    onClick={() => move(index, 1)?.catch(() => {})}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="cs-btn cs-btn-sm"
                    onClick={() => {
                      setEditingId(editingId === question.id ? null : question.id)
                      setAdding(false)
                    }}
                  >
                    {editingId === question.id ? t('editor.closeEdit') : t('editor.edit')}
                  </button>
                  <button
                    type="button"
                    className="cs-btn cs-btn-sm cs-btn-danger"
                    disabled={busy}
                    onClick={() =>
                      act(() => api.deleteQuestion(activity.id, question.id)).catch(() => {})
                    }
                  >
                    {t('common.delete')}
                  </button>
                </div>

                {editingId === question.id ? (
                  <div className="cs-q-body">
                    <QuestionForm
                      question={question}
                      busy={busy}
                      onCancel={() => setEditingId(null)}
                      onSave={async (body) => {
                        await act(() => api.updateQuestion(activity.id, question.id, body))
                        setEditingId(null)
                      }}
                    />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="cs-section">
        <h2 className="cs-section-head">{t('editor.danger')}</h2>
        <div className="cs-card">
          <p className="cs-hint" style={{ marginBottom: 'var(--s-3)' }}>
            {t('editor.dangerHint')}
          </p>
          <button type="button" className="cs-btn cs-btn-danger" onClick={remove}>
            {t('editor.deleteActivity')}
          </button>
        </div>
      </section>
    </>
  )
}
