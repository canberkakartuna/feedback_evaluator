import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { isStaff } from '../../../shared/roles'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { roleStringKey, useT } from '../../lib/i18n'
import ConsentCard from '../../components/ConsentCard'
import TopBar from '../../components/TopBar'
import TopicFilter, { matchesTopic } from '../../components/TopicFilter'
import '../../components/Entry.css'
import '../console.css'

/**
 * The student's way in: consent, then an activity.
 *
 * Consent is first and cannot be skipped — there is no route into a session
 * that does not create the consent record, on the server as well as here, so
 * the gate holds even against someone calling the API directly.
 *
 * After that there are exactly two ways to be here, and the screen asks which:
 *
 * - **Anonymously.** No account, no name, nothing asked. The list shows every
 *   published activity, because with no code and no credential, publishing is
 *   the whole access decision. This is what the study is designed around.
 * - **Signed in**, with an account their teacher made. Same screens, but the
 *   list is narrowed to their own teacher's work and the session carries their
 *   name so it can be followed across visits.
 *
 * **Staff are the third case, and they skip the consent step entirely.** The
 * notice asks a research participant to agree to being recorded; a teacher
 * opening their own activity to see what their class will see is not one, and
 * asking them to tick it would put staff clicks and student consent in the same
 * field. They land straight on the list, with a line saying what they are
 * looking at. routes/sessions.js enforces the same distinction, and stamps
 * whatever they start as a preview.
 *
 * A **class code** is the other door — see routes/student/Join.jsx. It is a
 * shortcut to one activity rather than a second identity: same consent, same
 * session, one less list to read.
 */
export default function StudentEntry() {
  const navigate = useNavigate()
  const t = useT()
  const { user, ready } = useAuth()

  const staff = ready && isStaff(user?.role)

  /**
   * `null` until someone presses something, and the first step is *derived*
   * rather than stored.
   *
   * Deriving it is what keeps a teacher from ever seeing the consent form. An
   * effect that corrected the step after mounting would run after the paint, so
   * there would be one frame of a form addressed to a research subject — brief,
   * and exactly the thing this screen is not supposed to show them.
   */
  const [chosen, setChosen] = useState(null)
  const [consented, setConsented] = useState(false)
  const [activities, setActivities] = useState(null)
  const [topic, setTopic] = useState('all')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const signedIn = ready && Boolean(user)
  const step = chosen ?? (staff ? 'pick' : 'consent')

  /**
   * Identity can change under them: the bar at the top of this screen signs
   * people out, and whoever is left behind is an anonymous visitor who has
   * agreed to nothing. A teacher who signs out mid-list is therefore sent back
   * to the notice rather than left holding a list they reached without it.
   */
  useEffect(() => {
    if (!ready || staff || consented) return
    if (step !== 'consent' && step !== 'declined') setChosen('consent')
  }, [consented, ready, staff, step])

  useEffect(() => {
    if (step !== 'pick') return

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
  }, [step])

  const begin = async (activityId) => {
    setBusy(true)
    setError(null)
    try {
      const { session } = await api.startSession({
        activityId,
        device: navigator.userAgent.slice(0, 120),
        // Staff were never shown the notice, so there is nothing to claim.
        consent: !staff,
      })
      navigate(`/work/${session.id}`, { replace: true })
    } catch (failure) {
      setError(failure.message)
      setBusy(false)
    }
  }

  // Identity first. Every branch below reads it, and guessing wrong for one
  // frame means showing a teacher a form addressed to a research subject.
  if (!ready) {
    return (
      <main className="splash">
        <p className="eyebrow">{t('app.loading')}</p>
      </main>
    )
  }

  if (step === 'declined') {
    return (
      <main className="en-page">
        <TopBar join />
        <div className="en-card">
          <p className="eyebrow">{t('entry.declined.eyebrow')}</p>
          <h1 className="en-title">{t('entry.declined.title')}</h1>
          <p className="en-lede">{t('entry.declined.lede')}</p>
          <button type="button" className="en-btn" onClick={() => setChosen('consent')}>
            {t('entry.declined.back')}
          </button>
        </div>
      </main>
    )
  }

  if (step === 'pick') {
    const shown = (activities ?? []).filter((activity) => matchesTopic(activity, topic))

    return (
      <main className="en-page">
        <TopBar join />
        <div className="en-card">
          {/* Staff skipped a step, so they are not on step 3 of anything. */}
          <p className="eyebrow">
            {staff ? t('entry.staff.eyebrow') : t('entry.step', { current: 3, total: 3 })}
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
            {/* Staff have no step to go back to; the bar above is their way out. */}
            {staff ? null : (
              <button
                type="button"
                className="en-btn"
                onClick={() => setChosen(signedIn ? 'consent' : 'who')}
              >
                {t('common.back')}
              </button>
            )}
            <Link className="en-btn" to="/join">
              {t('entry.pick.enterCode')}
            </Link>
          </div>
        </div>
      </main>
    )
  }

  if (step === 'who') {
    return (
      <main className="en-page">
        <TopBar join />
        <div className="en-card">
          <p className="eyebrow">{t('entry.step', { current: 2, total: 3 })}</p>
          <h1 className="en-title">{t('entry.who.title')}</h1>
          <p className="en-lede">{t('entry.who.lede')}</p>

          <div className="en-topics">
            <button
              type="button"
              className="en-topic"
              onClick={() => {
                setActivities(null)
                setChosen('pick')
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

          <div className="en-actions">
            <button type="button" className="en-btn" onClick={() => setChosen('consent')}>
              {t('common.back')}
            </button>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="en-page">
      <TopBar join />
      <ConsentCard
        eyebrow={`${t('entry.step', { current: 1, total: 3 })} · ${t('entry.consent.eyebrow')}`}
        onAgree={() => {
          setConsented(true)
          setChosen(signedIn ? 'pick' : 'who')
        }}
        onDecline={() => setChosen('declined')}
      />
    </main>
  )
}
