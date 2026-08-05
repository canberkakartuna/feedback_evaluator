import { useState } from 'react'
import { Link } from 'react-router-dom'
import { TOPICS } from '../../../shared/activity'
import { api } from '../../lib/api'
import { useT } from '../../lib/i18n'
import { useAsync } from '../../lib/useAsync'
import TopicFilter, { matchesTopic } from '../../components/TopicFilter'

/**
 * Every activity this teacher can reach, and the form that makes another.
 *
 * A new activity is created as a **draft** and stays invisible to students
 * until it is published, so open-or-draft is the fact worth putting on every
 * tile: it is the difference between work a class can see and work they cannot.
 * The class code sits beside it, because the second question about an activity
 * is always "what do I tell them to type?".
 *
 * The topic is set here rather than only in the editor, since it is the field a
 * teacher knows the answer to before they have written a single question — and it
 * is what both this list and the students' list are filtered by.
 */
export default function Activities() {
  const t = useT()
  const { data, error, loading, reload } = useAsync(() => api.activities(), [])
  const [title, setTitle] = useState('')
  const [blurb, setBlurb] = useState('')
  const [topic, setTopic] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState(null)
  const [filter, setFilter] = useState('all')

  const create = async (event) => {
    event.preventDefault()
    if (!title.trim()) return

    setBusy(true)
    setProblem(null)
    try {
      // '' is the "not set" option in the select; the API wants null for that.
      await api.createActivity({ title, blurb, topic: topic || null })
      setTitle('')
      setBlurb('')
      await reload()
    } catch (failure) {
      setProblem(failure.message)
    } finally {
      setBusy(false)
    }
  }

  const activities = data?.activities ?? []
  const shown = activities.filter((activity) => matchesTopic(activity, filter))

  return (
    <>
      <header className="cs-head">
        <div>
          <p className="eyebrow">{t('activities.eyebrow')}</p>
          <h1 className="cs-title">{t('activities.title')}</h1>
          <p className="cs-lede">{t('activities.lede')}</p>
        </div>
      </header>

      <section className="cs-card">
        <h2 className="cs-section-head">{t('activities.new')}</h2>
        <form className="cs-form" onSubmit={create}>
          <div className="cs-row">
            <div className="cs-field">
              <label className="cs-label" htmlFor="new-title">
                {t('activities.titleLabel')}
              </label>
              <input
                id="new-title"
                className="cs-input"
                required
                maxLength={200}
                placeholder={t('activities.titlePlaceholder')}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </div>

            <div className="cs-field">
              <label className="cs-label" htmlFor="new-topic">
                {t('topics.label')}
              </label>
              <select
                id="new-topic"
                className="cs-select"
                value={topic}
                onChange={(event) => setTopic(event.target.value)}
              >
                <option value="">{t('topics.unset')}</option>
                {TOPICS.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {t(`topics.${entry.id}`)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="cs-field">
            <label className="cs-label" htmlFor="new-blurb">
              {t('activities.blurbLabel')}{' '}
              <span style={{ textTransform: 'none' }}>{t('common.optional')}</span>
            </label>
            <input
              id="new-blurb"
              className="cs-input"
              maxLength={500}
              placeholder={t('activities.blurbPlaceholder')}
              value={blurb}
              onChange={(event) => setBlurb(event.target.value)}
            />
          </div>

          {problem ? (
            <p className="cs-note" data-tone="bad" role="alert">
              {problem}
            </p>
          ) : null}

          <div>
            <button type="submit" className="cs-btn cs-btn-primary" disabled={busy || !title.trim()}>
              {busy ? t('activities.creating') : t('activities.create')}
            </button>
          </div>
        </form>
      </section>

      <section className="cs-section">
        <h2 className="cs-section-head">
          {data?.scope === 'all' ? t('activities.scopeAll') : t('activities.scopeOwn')}
        </h2>

        {error ? (
          <p className="cs-note" data-tone="bad">
            {error.message}
          </p>
        ) : loading ? (
          <p className="cs-note">{t('common.loading')}</p>
        ) : activities.length === 0 ? (
          <p className="cs-empty">{t('activities.empty')}</p>
        ) : (
          <>
            <TopicFilter
              activities={activities}
              value={filter}
              onChange={setFilter}
              label={t('activities.filterLabel')}
            />

            {shown.length === 0 ? (
              <p className="cs-empty">{t('activities.noneInTopic')}</p>
            ) : (
              <div className="cs-grid">
                {shown.map((activity) => (
                  <Link
                    key={activity.id}
                    className="cs-tile"
                    to={`/teacher/activities/${activity.id}`}
                  >
                    <div className="cs-tile-top">
                      <span
                        className="cs-pill"
                        data-tone={activity.status === 'published' ? 'live' : 'draft'}
                      >
                        {activity.status === 'published'
                          ? t('activities.open')
                          : t('activities.draft')}
                      </span>
                      <span className="cs-tile-meta mono">
                        {t('common.questions', { count: activity.questionCount })}
                      </span>
                    </div>

                    <h3 className="cs-tile-name">{activity.title}</h3>
                    {activity.blurb ? <p className="cs-tile-meta">{activity.blurb}</p> : null}

                    <p className="cs-tile-meta mono">
                      {activity.topic ? `${t(`topics.${activity.topic}`)} · ` : ''}
                      {activity.code}
                    </p>
                  </Link>
                ))}
              </div>
            )}
          </>
        )}
      </section>
    </>
  )
}
