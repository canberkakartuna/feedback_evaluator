import { useState } from 'react'
import { api } from '../../lib/api'
import { useAsync } from '../../lib/useAsync'

/**
 * The one prompt every tutor chat runs on.
 *
 * System-wide, not per activity — that is what the brief asks for, and it is
 * also what makes the study answerable: comparing two prompts only means
 * something if you can say which sessions ran on which. So this is versioned
 * and append-only. Saving does not overwrite the old text, it adds v2 and makes
 * it current; every session already recorded keeps pointing at the version it
 * actually ran on.
 *
 * The warning below is not decoration. A teacher editing this is editing every
 * other teacher's students' feedback too, and there is nothing in the data
 * model that scopes it — so the screen has to say so.
 */
export default function SystemPrompt() {
  const { data, error, loading, reload } = useAsync(() => api.prompts(), [])
  const [text, setText] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState(null)
  const [saved, setSaved] = useState(false)

  const active = data?.active ?? null
  const versions = data?.versions ?? []

  const submit = async (event) => {
    event.preventDefault()
    if (!text.trim()) return

    setBusy(true)
    setProblem(null)
    setSaved(false)

    try {
      await api.setPrompt(text, note)
      setText('')
      setNote('')
      setSaved(true)
      await reload()
    } catch (failure) {
      setProblem(failure.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <header className="cs-head">
        <div>
          <p className="eyebrow">Tutor behaviour</p>
          <h1 className="cs-title">AI prompt</h1>
          <p className="cs-lede">
            The instruction sitting behind every chat box in the system. Saving creates a new
            version and makes it current — nothing is overwritten.
          </p>
        </div>
      </header>

      <p className="cs-note" data-tone="warn">
        This applies to <strong>every activity and every teacher</strong>, not just yours. Sessions
        already recorded keep the version they ran on, so past data stays interpretable.
      </p>

      <section className="cs-card" style={{ marginTop: 'var(--s-4)' }}>
        <p className="eyebrow">Currently active</p>
        {loading ? (
          <p className="cs-hint">Loading…</p>
        ) : error ? (
          <p className="cs-note" data-tone="bad">
            {error.message}
          </p>
        ) : active ? (
          <>
            <p className="mono cs-hint">
              {active.versionId}
              {active.createdByName ? ` · set by ${active.createdByName}` : ''} ·{' '}
              {new Date(active.createdAt).toLocaleString()}
            </p>
            <p style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>{active.text}</p>
          </>
        ) : (
          <p className="cs-hint">
            None set. The tutor is running on its built-in behaviour until you write one.
          </p>
        )}
      </section>

      <section className="cs-section">
        <h2 className="cs-section-head">Write a new version</h2>
        <form className="cs-form" onSubmit={submit}>
          <div className="cs-field">
            <label className="cs-label" htmlFor="prompt-text">
              Prompt
            </label>
            <textarea
              id="prompt-text"
              className="cs-textarea"
              rows={7}
              required
              maxLength={20000}
              placeholder="Never give the final answer. Ask one question back that moves the student one step closer."
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          </div>

          <div className="cs-field">
            <label className="cs-label" htmlFor="prompt-note">
              What changed <span style={{ textTransform: 'none' }}>(optional)</span>
            </label>
            <input
              id="prompt-note"
              className="cs-input"
              maxLength={500}
              placeholder="More socratic, refuses worked examples before two attempts"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>

          {problem ? (
            <p className="cs-note" data-tone="bad" role="alert">
              {problem}
            </p>
          ) : null}
          {saved ? (
            <p className="cs-note" data-tone="good" role="status">
              Saved. New sessions will use it from now on.
            </p>
          ) : null}

          <div>
            <button type="submit" className="cs-btn cs-btn-primary" disabled={busy || !text.trim()}>
              {busy ? 'Saving…' : 'Save as new version'}
            </button>
          </div>
        </form>
      </section>

      {versions.length > 1 ? (
        <section className="cs-section">
          <h2 className="cs-section-head">History</h2>
          <div className="cs-scroll-x">
            <table className="cs-table">
              <thead>
                <tr>
                  <th>Version</th>
                  <th>Set by</th>
                  <th>When</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {[...versions].reverse().map((version) => (
                  <tr key={version.versionId}>
                    <td className="mono">{version.versionId}</td>
                    <td>{version.createdByName ?? '—'}</td>
                    <td className="mono">{new Date(version.createdAt).toLocaleDateString()}</td>
                    <td>{version.note ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </>
  )
}
