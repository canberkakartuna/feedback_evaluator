import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { SUPPORT_CATEGORIES } from '../../shared/support'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useT } from '../lib/i18n'
import { useAsync } from '../lib/useAsync'
import Navbar from '../components/Navbar'
import SupportMessage from '../components/SupportMessage'
import '../components/Entry.css'
import './console.css'

const CATEGORY_KEY = { support: 'support.categorySupport', suggestion: 'support.categorySuggestion' }

/**
 * The support / suggestion channel, for anyone signed in (3 Nov 2026 doc).
 *
 * Write a message under a category with a title; replies appear under it here,
 * the next time they sign in. Opening the page marks the replies read, which
 * is what puts out the dot on the Support button in the navbar.
 */
export default function Support() {
  const t = useT()
  const { user, ready } = useAuth()
  const mine = useAsync(() => (user ? api.mySupport() : Promise.resolve({ messages: [] })), [user?.id])

  const [category, setCategory] = useState('support')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [sent, setSent] = useState(false)

  // Read once shown — after the list has loaded with its unread flags intact.
  const hasUnread = (mine.data?.messages ?? []).some((message) => message.unread)
  useEffect(() => {
    if (hasUnread) api.markSupportSeen().catch(() => {})
  }, [hasUnread])

  if (!ready) {
    return (
      <main className="splash">
        <p className="eyebrow">{t('app.loading')}</p>
      </main>
    )
  }
  if (!user) return <Navigate to="/" replace />

  const send = async (event) => {
    event.preventDefault()
    if (!subject.trim() || !body.trim()) return
    setBusy(true)
    setError(null)
    setSent(false)
    try {
      await api.sendSupport({ category, subject, body })
      setSubject('')
      setBody('')
      setSent(true)
      mine.reload()
    } catch (failure) {
      setError(failure.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="en-page">
      <Navbar />
      <div className="en-card">
        <p className="eyebrow">{t('support.eyebrow')}</p>
        <h1 className="en-title">{t('support.title')}</h1>
        <p className="en-lede">{t('support.lede')}</p>

        <form className="cs-form" style={{ marginTop: 'var(--s-4)' }} onSubmit={send}>
          <div className="cs-field">
            <label className="cs-label" htmlFor="sp-category">
              {t('support.category')}
            </label>
            <select
              id="sp-category"
              className="cs-select"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              {SUPPORT_CATEGORIES.map((id) => (
                <option key={id} value={id}>
                  {t(CATEGORY_KEY[id])}
                </option>
              ))}
            </select>
          </div>

          <div className="cs-field">
            <label className="cs-label" htmlFor="sp-subject">
              {t('support.subject')}
            </label>
            <input
              id="sp-subject"
              className="cs-input"
              maxLength={160}
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
            />
          </div>

          <div className="cs-field">
            <label className="cs-label" htmlFor="sp-body">
              {t('support.body')}
            </label>
            <textarea
              id="sp-body"
              className="cs-textarea"
              rows={4}
              maxLength={5000}
              value={body}
              onChange={(event) => setBody(event.target.value)}
            />
          </div>

          {error ? (
            <p className="cs-note" data-tone="bad" role="alert">
              {error}
            </p>
          ) : null}
          {sent ? (
            <p className="cs-note" data-tone="good" role="status">
              {t('support.sent')}
            </p>
          ) : null}

          <div className="cs-actions">
            <button
              type="submit"
              className="cs-btn cs-btn-primary"
              disabled={busy || !subject.trim() || !body.trim()}
            >
              {busy ? t('common.saving') : t('support.send')}
            </button>
          </div>
        </form>

        <h2 className="en-terms-head" style={{ marginTop: 'var(--s-6)' }}>
          {t('support.mine')}
        </h2>
        {mine.error ? (
          <p className="cs-note" data-tone="bad">
            {mine.error.message}
          </p>
        ) : mine.loading ? (
          <p className="cs-note">{t('common.loading')}</p>
        ) : mine.data.messages.length === 0 ? (
          <p className="cs-hint">{t('support.none')}</p>
        ) : (
          <div className="sp-list">
            {mine.data.messages.map((message) => (
              <SupportMessage key={message.id} message={message} />
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
