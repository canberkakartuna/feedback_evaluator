import { useEffect, useState } from 'react'
import { Link, useNavigate, useOutletContext } from 'react-router-dom'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { roleStringKey, useT } from '../../lib/i18n'
import TopicFilter, { matchesTopic } from '../../components/TopicFilter'

/**
 * What to work on — the last step, and the only one this file owns.
 *
 * Who they are and whether they have consented were both settled by
 * StudentLayout, which is why neither appears here: this screen cannot be reached
 * without having passed them. What is left is the list, and how it is narrowed:
 *
 * - **Anonymously.** No account, no name, nothing asked. Every published activity
 *   is shown, because with no code and no credential, publishing is the whole
 *   access decision. This is what the study is designed around.
 * - **Signed in**, with an account their teacher made. Same screen, but narrowed
 *   to their own teacher's work, and the session carries their name so it can be
 *   followed across visits.
 * - **Staff** get the same list with a line saying that anything they start is
 *   recorded as a preview rather than as a student's work.
 *
 * A **class code** is the other door — see ./Join.jsx. It is a shortcut to one
 * activity rather than a second identity: same consent, same session, one less
 * list to read.
 */
export default function StudentEntry() {
  const navigate = useNavigate()
  const t = useT()
  const { user, ready } = useAuth()
  const { staff, consent, nickname, step, totalSteps } = useOutletContext()

  const [activities, setActivities] = useState(null)
  const [topic, setTopic] = useState('all')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const signedIn = ready && Boolean(user)

  useEffect(() => {
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
  }, [])

  const begin = async (activityId) => {
    setBusy(true)
    setError(null)
    try {
      const { session } = await api.startSession({
        activityId,
        device: navigator.userAgent.slice(0, 120),
        nickname,
        consent,
      })
      navigate(`/work/${session.id}`, { replace: true })
    } catch (failure) {
      setError(failure.message)
      setBusy(false)
    }
  }

  const shown = (activities ?? []).filter((activity) => matchesTopic(activity, topic))

  return (
    <div className="en-card">
      {/* Staff skipped the notice, so they are not on a numbered step at all. */}
      <p className="eyebrow">
        {staff ? t('entry.staff.eyebrow') : t('entry.step', { current: step, total: totalSteps })}
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
        <Link className="en-btn" to="/join">
          {t('entry.pick.enterCode')}
        </Link>
      </div>
    </div>
  )
}
