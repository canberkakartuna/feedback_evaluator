import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { isStaff } from '../../../shared/roles'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useT } from '../../lib/i18n'
import ConsentCard from '../../components/ConsentCard'
import TopBar from '../../components/TopBar'
import '../../components/Entry.css'
import '../console.css'

/**
 * The class-code door: six characters, or the link that carries them.
 *
 * `/join/ABC234` resolves on arrival, which is what makes it a link worth
 * putting in a lesson plan or a class chat. `/join` on its own asks for the code,
 * which is what makes it worth reading off a projector. Both end in the same
 * place as the list on the entry screen — same consent, same session, same
 * workspace — because a code is a shortcut and not a second way of being a
 * student.
 *
 * It is **not a password**. A code only opens an activity its teacher has
 * published; a draft says so rather than opening. That rule lives in
 * routes/activities.js and routes/sessions.js, so it holds against a hand-typed
 * URL as well as against this screen.
 *
 * Staff skip the consent step here for the same reason they skip it on the entry
 * screen: the notice is addressed to a research participant.
 */
export default function Join() {
  const { code: fromUrl } = useParams()
  const navigate = useNavigate()
  const t = useT()
  const { user, ready } = useAuth()

  const staff = ready && isStaff(user?.role)

  const [code, setCode] = useState(fromUrl ?? '')
  const [activity, setActivity] = useState(null)
  const [phase, setPhase] = useState(fromUrl ? 'looking' : 'ask')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const look = useCallback(
    async (candidate) => {
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
    },
    [],
  )

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
        consent: !staff,
      })
      navigate(`/work/${session.id}`, { replace: true })
    } catch (failure) {
      setError(failure.message)
      setBusy(false)
      // Straight back to the code, since the usual cause is a teacher closing
      // the activity between the lookup and the press.
      setPhase('found')
    }
  }

  // As on the entry screen: whether the consent step applies depends on who is
  // looking, so nothing renders until that is known.
  if (!ready) {
    return (
      <main className="splash">
        <p className="eyebrow">{t('app.loading')}</p>
      </main>
    )
  }

  if (phase === 'declined') {
    return (
      <main className="en-page">
        <TopBar />
        <div className="en-card">
          <p className="eyebrow">{t('entry.declined.eyebrow')}</p>
          <h1 className="en-title">{t('entry.declined.title')}</h1>
          <p className="en-lede">{t('entry.declined.lede')}</p>
          <button type="button" className="en-btn" onClick={() => setPhase('found')}>
            {t('entry.declined.back')}
          </button>
        </div>
      </main>
    )
  }

  if (phase === 'consent') {
    return (
      <main className="en-page">
        <TopBar />
        <ConsentCard
          eyebrow={`${t('entry.step', { current: 2, total: 2 })} · ${t('entry.consent.eyebrow')}`}
          onAgree={begin}
          onDecline={() => setPhase('declined')}
        />
      </main>
    )
  }

  if (phase === 'found') {
    return (
      <main className="en-page">
        <TopBar />
        <div className="en-card">
          <p className="eyebrow">
            {staff ? t('entry.staff.eyebrow') : t('entry.step', { current: 1, total: 2 })} ·{' '}
            <span className="mono">{activity.code}</span>
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
              onClick={() => (staff ? begin() : setPhase('consent'))}
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
      </main>
    )
  }

  return (
    <main className="en-page">
      <TopBar />
      <div className="en-card">
        <p className="eyebrow">{t('join.eyebrow')}</p>
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
            <button
              type="submit"
              className="en-btn en-btn-primary"
              disabled={busy || !code.trim()}
            >
              {busy || phase === 'looking' ? t('join.busy') : t('join.submit')}
            </button>
            <Link className="en-btn" to="/">
              {t('join.orList')}
            </Link>
          </div>
        </form>
      </div>
    </main>
  )
}
