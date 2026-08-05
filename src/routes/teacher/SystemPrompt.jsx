import { useState } from 'react'
import { api } from '../../lib/api'
import { useI18n } from '../../lib/i18n'
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
  const { lang, t } = useI18n()
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
          <p className="eyebrow">{t('prompt.eyebrow')}</p>
          <h1 className="cs-title">{t('prompt.title')}</h1>
          <p className="cs-lede">{t('prompt.lede')}</p>
        </div>
      </header>

      <p className="cs-note" data-tone="warn">
        {t('prompt.warn')}
      </p>

      <section className="cs-card" style={{ marginTop: 'var(--s-4)' }}>
        <p className="eyebrow">{t('prompt.active')}</p>
        {loading ? (
          <p className="cs-hint">{t('common.loading')}</p>
        ) : error ? (
          <p className="cs-note" data-tone="bad">
            {error.message}
          </p>
        ) : active ? (
          <>
            <p className="mono cs-hint">
              {active.versionId}
              {active.createdByName
                ? ` · ${t('prompt.setBy', { name: active.createdByName })}`
                : ''}{' '}
              · {new Date(active.createdAt).toLocaleString(lang)}
            </p>
            <p style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>{active.text}</p>
          </>
        ) : (
          <p className="cs-hint">{t('prompt.none')}</p>
        )}
      </section>

      <section className="cs-section">
        <h2 className="cs-section-head">{t('prompt.newVersion')}</h2>
        <form className="cs-form" onSubmit={submit}>
          <div className="cs-field">
            <label className="cs-label" htmlFor="prompt-text">
              {t('prompt.promptLabel')}
            </label>
            <textarea
              id="prompt-text"
              className="cs-textarea"
              rows={7}
              required
              maxLength={20000}
              placeholder={t('prompt.promptPlaceholder')}
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          </div>

          <div className="cs-field">
            <label className="cs-label" htmlFor="prompt-note">
              {t('prompt.noteLabel')}{' '}
              <span style={{ textTransform: 'none' }}>{t('common.optional')}</span>
            </label>
            <input
              id="prompt-note"
              className="cs-input"
              maxLength={500}
              placeholder={t('prompt.notePlaceholder')}
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
              {t('prompt.saved')}
            </p>
          ) : null}

          <div>
            <button type="submit" className="cs-btn cs-btn-primary" disabled={busy || !text.trim()}>
              {busy ? t('common.saving') : t('prompt.save')}
            </button>
          </div>
        </form>
      </section>

      {versions.length > 1 ? (
        <section className="cs-section">
          <h2 className="cs-section-head">{t('prompt.history')}</h2>
          <div className="cs-scroll-x">
            <table className="cs-table">
              <thead>
                <tr>
                  <th>{t('prompt.thVersion')}</th>
                  <th>{t('prompt.thSetBy')}</th>
                  <th>{t('prompt.thWhen')}</th>
                  <th>{t('prompt.thNote')}</th>
                </tr>
              </thead>
              <tbody>
                {[...versions].reverse().map((version) => (
                  <tr key={version.versionId}>
                    <td className="mono">{version.versionId}</td>
                    <td>{version.createdByName ?? '—'}</td>
                    <td className="mono">
                      {new Date(version.createdAt).toLocaleDateString(lang)}
                    </td>
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
