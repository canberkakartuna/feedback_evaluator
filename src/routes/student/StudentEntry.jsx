import { useEffect, useState } from 'react'
import { Link, useNavigate, useOutletContext } from 'react-router-dom'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { roleStringKey, useT } from '../../lib/i18n'
import TopicFilter, { matchesTopic } from '../../components/TopicFilter'

/**
 * What to work on — the screen after consent.
 *
 * Consent itself is not here: StudentLayout owns it, and this screen cannot be
 * reached without having passed it. What is left is the question that actually
 * belongs to this screen, and there are two ways to answer it:
 *
 * - **Anonymously.** No account, no name, nothing asked. The list shows every
 *   published activity, because with no code and no credential, publishing is
 *   the whole access decision. This is what the study is designed around.
 * - **Signed in**, with an account their teacher made. Same screens, but the
 *   list is narrowed to their own teacher's work and the session carries their
 *   name so it can be followed across visits.
 *
 * Staff arrive here directly, since the layout does not stop them, and see a line
 * saying that what they start will be recorded as a preview.
 *
 * A **class code** is the other door — see ./Join.jsx. It is a shortcut to one
 * activity rather than a second identity: same consent, same session, one less
 * list to read.
 */
export default function StudentEntry() {
  const navigate = useNavigate()
  const t = useT()
  const { user, ready } = useAuth()
  const { staff, consent, totalSteps } = useOutletContext()

  const [step, setStep] = useState('who')
  const [activities, setActivities] = useState(null)
  const [topic, setTopic] = useState('all')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const signedIn = ready && Boolean(user)

  /**
   * Asking an anonymous visitor how they are working is worth a step; asking
   * someone who is already signed in is asking a question they have answered by
   * being here. Derived rather than stored, so signing out from the bar above
   * puts the choice back rather than leaving them on a list they skipped it from.
   */
  const showing = signedIn && step === 'who' ? 'pick' : step

  useEffect(() => {
    if (showing !== 'pick') return

    let alive = true
    api
      .availableActivities()
      .then((result) => alive && setActivities(result.activities))
      .catch((failure) => {
        if (!alive) return
        setActivities([])
        setError(failure.message)
      })

    return () => {
      alive = false
    }
  }, [showing])

  const begin = async (activityId) => {
    setBusy(true)
    setError(null)
    try {
      const { session } = await api.startSession({
        activityId,
        device: navigator.userAgent.slice(0, 120),
        consent,
      })
      navigate(`/work/${session.id}`, { replace: true })
    } catch (failure) {
      setError(failure.message)
      setBusy(false)
    }
  }

  if (showing === 'who') {
    return (
      <div className="en-card">
        <p className="eyebrow">{t('entry.step', { current: 2, total: totalSteps })}</p>
        <h1 className="en-title">{t('entry.who.title')}</h1>
        <p className="en-lede">{t('entry.who.lede')}</p>

        <div className="en-topics">
          <button
            type="button"
            className="en-topic"
            onClick={() => {
              setActivities(null)
              setStep('pick')
            }}
          >
            <span className="en-topic-name">{t('entry.who.anon')}</span>
            <span className="en-topic-meta">{t('entry.who.anonMeta')}</span>
          </button>

          <Link className="en-topic" to="/signin" state={{ from: '/' }}>
            <span className="en-topic-name">{t('entry.who.signIn')}</span>
            <span className="en-topic-meta">{t('entry.who.signInMeta')}</span>
          </Link>
        </div>
      </div>
    )
  }

  const shown = (activities ?? []).filter((activity) => matchesTopic(activity, topic))

  return (
    <div className="en-card">
      {/* Staff skipped the notice, so they are not on step 3 of anything. */}
      <p className="eyebrow">
        {staff
          ? t('entry.staff.eyebrow')
          : t('entry.step', { current: totalSteps, total: totalSteps })}
      </p>
      <h1 className="en-title">{t('entry.pick.title')}</h1>
      <p className="en-lede">
        {signedIn ? t('entry.pick.ledeSignedIn') : t('entry.pick.ledeAnon')}
      </p>

      {error ? (
        <p className="cs-note" data-tone="bad" role="alert">
          {error}
        </p>
      ) : null}

      {staff ? (
        <p className="cs-note" data-tone="warn">
          {t('entry.staff.notice', { role: t(roleStringKey(user.role)) })}
        </p>
      ) : signedIn ? (
        <p className="cs-hint" style={{ marginBottom: 'var(--s-4)' }}>
          {t('entry.pick.signedInAs', { name: user.name })}
        </p>
      ) : null}

      {activities === null ? (
        <p className="cs-note">{t('common.loading')}</p>
      ) : activities.length === 0 ? (
        <p className="cs-empty">{t('entry.pick.empty')}</p>
      ) : (
        <>
          <TopicFilter activities={activities} value={topic} onChange={setTopic} />

          {shown.length === 0 ? (
            <p className="cs-empty">{t('entry.pick.noneInTopic')}</p>
          ) : (
            <div className="en-topics">
              {shown.map((activity) => (
                <button
                  key={activity.id}
                  type="button"
                  className="en-topic"
                  disabled={busy}
                  onClick={() => begin(activity.id)}
                >
                  <span className="en-topic-name">{activity.title}</span>
                  <span className="en-topic-meta mono">
                    {activity.topic ? `${t(`topics.${activity.topic}`)} · ` : ''}
                    {t('common.questions', { count: activity.questionCount })}
                  </span>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      <div className="en-actions">
        {/* Anonymous visitors came through the "how are you working" step and
            can go back to it. Nobody else has one to go back to. */}
        {signedIn || staff ? null : (
          <button type="button" className="en-btn" onClick={() => setStep('who')}>
            {t('common.back')}
          </button>
        )}
        <Link className="en-btn" to="/join">
          {t('entry.pick.enterCode')}
        </Link>
      </div>
    </div>
  )
}
