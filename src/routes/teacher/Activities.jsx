import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../lib/api'
import { useAsync } from '../../lib/useAsync'

/**
 * Every activity this teacher can reach, and the form that makes another.
 *
 * A new activity is created as a **draft** and stays invisible to students
 * until it is published, so open-or-draft is the fact worth putting on every
 * tile: it is the difference between work a class can see and work they cannot.
 */
export default function Activities() {
  const { data, error, loading, reload } = useAsync(() => api.activities(), [])
  const [title, setTitle] = useState('')
  const [blurb, setBlurb] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState(null)

  const create = async (event) => {
    event.preventDefault()
    if (!title.trim()) return

    setBusy(true)
    setProblem(null)
    try {
      await api.createActivity({ title, blurb })
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

  return (
    <>
      <header className="cs-head">
        <div>
          <p className="eyebrow">Authoring</p>
          <h1 className="cs-title">Activities</h1>
          <p className="cs-lede">
            An activity is a set of questions. Publishing it is what puts it in front of students —
            they open the site, agree to the consent notice, and pick it from a list. Everything
            they say to the tutor is recorded against it.
          </p>
        </div>
      </header>

      <section className="cs-card">
        <h2 className="cs-section-head">New activity</h2>
        <form className="cs-form" onSubmit={create}>
          <div className="cs-row">
            <div className="cs-field">
              <label className="cs-label" htmlFor="new-title">
                Title
              </label>
              <input
                id="new-title"
                className="cs-input"
                required
                maxLength={200}
                placeholder="Membranes &amp; transport"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </div>

            <div className="cs-field">
              <label className="cs-label" htmlFor="new-blurb">
                Blurb <span style={{ textTransform: 'none' }}>(optional)</span>
              </label>
              <input
                id="new-blurb"
                className="cs-input"
                maxLength={500}
                placeholder="How things cross the membrane, and what it costs."
                value={blurb}
                onChange={(event) => setBlurb(event.target.value)}
              />
            </div>
          </div>

          {problem ? (
            <p className="cs-note" data-tone="bad" role="alert">
              {problem}
            </p>
          ) : null}

          <div>
            <button type="submit" className="cs-btn cs-btn-primary" disabled={busy || !title.trim()}>
              {busy ? 'Creating…' : 'Create activity'}
            </button>
          </div>
        </form>
      </section>

      <section className="cs-section">
        <h2 className="cs-section-head">
          {data?.scope === 'all' ? 'Everything in the system' : 'Yours'}
        </h2>

        {error ? (
          <p className="cs-note" data-tone="bad">
            {error.message}
          </p>
        ) : loading ? (
          <p className="cs-note">Loading…</p>
        ) : activities.length === 0 ? (
          <p className="cs-empty">
            Nothing yet. Create an activity above, add a question or two, then publish it so
            students can see it.
          </p>
        ) : (
          <div className="cs-grid">
            {activities.map((activity) => (
              <Link
                key={activity.id}
                className="cs-tile"
                to={`/teacher/activities/${activity.id}`}
              >
                <div className="cs-tile-top">
                  <span className="cs-pill" data-tone={activity.status === 'published' ? 'live' : 'draft'}>
                    {activity.status === 'published' ? 'Open' : 'Draft'}
                  </span>
                  <span className="cs-tile-meta mono">
                    {activity.questionCount} {activity.questionCount === 1 ? 'question' : 'questions'}
                  </span>
                </div>

                <h3 className="cs-tile-name">{activity.title}</h3>
                {activity.blurb ? <p className="cs-tile-meta">{activity.blurb}</p> : null}
              </Link>
            ))}
          </div>
        )}
      </section>
    </>
  )
}
