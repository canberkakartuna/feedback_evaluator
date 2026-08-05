import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useOutletContext, useParams } from 'react-router-dom'
import { api } from '../../lib/api'
import { useT } from '../../lib/i18n'

/**
 * The class-code door: six characters, or the link that carries them.
 *
 * `/join/ABC234` resolves as soon as this screen is reached, which is what makes
 * it a link worth putting in a lesson plan or a class chat. `/join` on its own
 * asks for the code, which is what makes it worth reading off a projector. Both
 * end in the same place as the list on the entry screen — same session, same
 * workspace — because a code is a shortcut and not a second way of being a
 * student.
 *
 * Consent comes first, from StudentLayout, and before the lookup: this screen
 * does not mount, and so asks the API nothing, until the notice has been agreed
 * to. There is no "how are you working" step on this path — arriving with a code
 * is already a declaration — so the notice is the first thing a student sees here.
 * Staff are not asked at all, and land straight on the form.
 *
 * The code is **not a password**. It only opens an activity its teacher has
 * published; a draft says so rather than opening. That rule lives in
 * routes/activities.js and routes/sessions.js, so it holds against a hand-typed
 * URL as well as against this screen.
 */
export default function Join() {
  const { code: fromUrl } = useParams()
  const navigate = useNavigate()
  const t = useT()
  const { staff, consent, step, totalSteps } = useOutletContext()

  const [code, setCode] = useState(fromUrl ?? '')
  const [activity, setActivity] = useState(null)
  const [phase, setPhase] = useState(fromUrl ? 'looking' : 'ask')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const look = useCallback(async (candidate) => {
    const wanted = candidate.trim()
    if (!wanted) return

    setBusy(true)
    setError(null)

    try {
      const { activity: found } = await api.activityByCode(wanted)
      setActivity(found)
      setPhase('found')
    } catch (failure) {
      setError(failure.message)
      setPhase('ask')
    } finally {
      setBusy(false)
    }
  }, [])

  // A code in the URL is a link somebody followed: resolve it without making
  // them press a button to confirm what they already clicked.
  useEffect(() => {
    if (fromUrl) look(fromUrl)
  }, [fromUrl, look])

  const begin = async () => {
    setBusy(true)
    setError(null)

    try {
      const { session } = await api.startSession({
        code: activity.code,
        device: navigator.userAgent.slice(0, 120),
        consent,
      })
      navigate(`/work/${session.id}`, { replace: true })
    } catch (failure) {
      setError(failure.message)
      setBusy(false)
      // The usual cause is a teacher closing the activity between the lookup and
      // the press, and the code is the thing they will want to try again.
      setPhase('found')
    }
  }

  if (phase === 'found') {
    return (
      <div className="en-card">
        <p className="eyebrow">
          {staff
            ? t('entry.staff.eyebrow')
            : t('entry.step', { current: step, total: totalSteps })}{' '}
          · <span className="mono">{activity.code}</span>
        </p>
        <h1 className="en-title">{activity.title}</h1>
        <p className="en-lede">{t('join.found')}</p>

        <div className="en-terms">
          {activity.blurb ? <p style={{ margin: 0 }}>{activity.blurb}</p> : null}
          <p className="cs-hint mono" style={{ marginBottom: 0 }}>
            {activity.topic ? `${t(`topics.${activity.topic}`)} · ` : ''}
            {t('common.questions', { count: activity.questionCount })}
          </p>
        </div>

        {error ? (
          <p className="cs-note" data-tone="bad" role="alert">
            {error}
          </p>
        ) : null}

        <div className="en-actions">
          <button
            type="button"
            className="en-btn en-btn-primary"
            disabled={busy}
            onClick={begin}
          >
            {busy ? t('join.starting') : t('join.start')}
          </button>
          <button
            type="button"
            className="en-btn"
            onClick={() => {
              setActivity(null)
              setCode('')
              setPhase('ask')
            }}
          >
            {t('join.another')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="en-card">
      <p className="eyebrow">
        {staff
          ? t('entry.staff.eyebrow')
          : t('entry.step', { current: step, total: totalSteps })}{' '}
        · {t('join.eyebrow')}
      </p>
      <h1 className="en-title">{t('join.title')}</h1>
      <p className="en-lede">{t('join.lede')}</p>

      <form
        className="cs-form"
        onSubmit={(event) => {
          event.preventDefault()
          look(code)
        }}
      >
        <div className="cs-field">
          <label className="cs-label" htmlFor="class-code">
            {t('join.label')}
          </label>
          <input
            id="class-code"
            className="cs-input mono"
            autoFocus
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck="false"
            maxLength={12}
            placeholder={t('join.placeholder')}
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
          />
        </div>

        {error ? (
          <p className="cs-note" data-tone="bad" role="alert">
            {error}
          </p>
        ) : null}

        <div className="en-actions">
          <button type="submit" className="en-btn en-btn-primary" disabled={busy || !code.trim()}>
            {busy || phase === 'looking' ? t('join.busy') : t('join.submit')}
          </button>
          <Link className="en-btn" to="/">
            {t('join.orList')}
          </Link>
        </div>
      </form>
    </div>
  )
}
