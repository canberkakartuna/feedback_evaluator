import { useState } from 'react'
import { api } from '../../lib/api'
import { useT } from '../../lib/i18n'
import { useAsync } from '../../lib/useAsync'
import SupportMessage from '../../components/SupportMessage'

/**
 * Support and suggestions written in, split by category (3 Nov 2026 doc).
 *
 * A teacher sees their own students' messages; a manager or admin sees them
 * all, including teachers' own. The scope is the server's — routes/support.js.
 */
export default function SupportInbox() {
  const t = useT()
  const [category, setCategory] = useState('')
  const inbox = useAsync(() => api.supportInbox(category || undefined), [category])
  const [drafts, setDrafts] = useState({})
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState(null)

  const reply = async (event, messageId) => {
    event.preventDefault()
    const text = (drafts[messageId] ?? '').trim()
    if (!text) return
    setBusyId(messageId)
    setError(null)
    try {
      await api.replySupport(messageId, text)
      setDrafts((prior) => ({ ...prior, [messageId]: '' }))
      inbox.reload()
    } catch (failure) {
      setError(failure.message)
    } finally {
      setBusyId(null)
    }
  }

  const filters = [
    { id: '', key: 'support.all' },
    { id: 'support', key: 'support.categorySupport' },
    { id: 'suggestion', key: 'support.categorySuggestion' },
  ]

  return (
    <>
      <header className="cs-head">
        <div>
          <p className="eyebrow">{t('support.inboxEyebrow')}</p>
          <h1 className="cs-title">{t('support.inboxTitle')}</h1>
          <p className="cs-lede">{t('support.inboxLede')}</p>
        </div>
      </header>

      <div className="sp-filter" role="group" aria-label={t('support.category')}>
        {filters.map((filter) => (
          <button
            key={filter.id || 'all'}
            type="button"
            className={category === filter.id ? 'cs-btn cs-btn-sm cs-btn-primary' : 'cs-btn cs-btn-sm'}
            aria-pressed={category === filter.id}
            onClick={() => setCategory(filter.id)}
          >
            {t(filter.key)}
          </button>
        ))}
      </div>

      {error ? (
        <p className="cs-note" data-tone="bad" role="alert" style={{ marginTop: 'var(--s-4)' }}>
          {error}
        </p>
      ) : null}

      {inbox.error ? (
        <p className="cs-note" data-tone="bad">
          {inbox.error.message}
        </p>
      ) : inbox.loading ? (
        <p className="cs-note">{t('common.loading')}</p>
      ) : inbox.data.messages.length === 0 ? (
        <p className="cs-empty" style={{ marginTop: 'var(--s-4)' }}>
          {t('support.inboxEmpty')}
        </p>
      ) : (
        <div className="sp-list">
          {inbox.data.messages.map((message) => (
            <SupportMessage key={message.id} message={message} from>
              <form className="sp-reply-form" onSubmit={(event) => reply(event, message.id)}>
                <label className="sr-only" htmlFor={`reply-${message.id}`}>
                  {t('support.replyLabel')}
                </label>
                <textarea
                  id={`reply-${message.id}`}
                  className="cs-textarea"
                  rows={2}
                  maxLength={5000}
                  placeholder={message.reply ? t('support.replyAgain') : t('support.replyLabel')}
                  value={drafts[message.id] ?? ''}
                  onChange={(event) =>
                    setDrafts((prior) => ({ ...prior, [message.id]: event.target.value }))
                  }
                />
                <div className="cs-actions">
                  <button
                    type="submit"
                    className="cs-btn cs-btn-sm cs-btn-primary"
                    disabled={busyId === message.id || !(drafts[message.id] ?? '').trim()}
                  >
                    {busyId === message.id ? t('common.saving') : t('support.reply')}
                  </button>
                </div>
              </form>
            </SupportMessage>
          ))}
        </div>
      )}
    </>
  )
}
