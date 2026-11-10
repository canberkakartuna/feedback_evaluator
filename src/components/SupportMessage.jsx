import { useI18n } from '../lib/i18n'
import './Support.css'

const when = (iso, lang) =>
  iso
    ? new Date(iso).toLocaleString(lang, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : ''

/**
 * One support or suggestion message, with the conversation under it: staff
 * replies and the writer's own follow-ups (`fromWriter`), in order. Shown to
 * the writer on /support and to staff in the inbox; `from` names the writer,
 * which only the inbox needs. `children` is the reply box — staff's in the
 * inbox, the writer's on /support.
 */
export default function SupportMessage({ message, from = false, children }) {
  const { lang, t } = useI18n()

  return (
    <article className="sp-msg" data-unread={message.unread || undefined}>
      <header className="sp-msg-head">
        <span className="cs-pill" data-tone={message.category === 'support' ? 'draft' : 'live'}>
          {message.category === 'support' ? t('support.categorySupport') : t('support.categorySuggestion')}
        </span>
        <h3 className="sp-msg-subject">{message.subject}</h3>
        <span className="sp-msg-when mono">{when(message.createdAt, lang)}</span>
      </header>
      {from ? <p className="sp-msg-from mono">{message.userName}</p> : null}
      <p className="sp-msg-body">{message.body}</p>

      {(message.replies ?? []).map((reply, index) => (
        <div key={`${reply.at}-${index}`} className="sp-reply" data-writer={reply.fromWriter || undefined}>
          <p className="sp-reply-head eyebrow">
            {reply.fromWriter
              ? from
                ? t('support.followUpFrom', { name: reply.byName, date: when(reply.at, lang) })
                : t('support.youWrote', { date: when(reply.at, lang) })
              : t('support.replyFrom', { name: reply.byName, date: when(reply.at, lang) })}
          </p>
          <p className="sp-msg-body">{reply.text}</p>
        </div>
      ))}
      {/* Waiting on staff: nothing answered yet, or the writer spoke last. */}
      {!message.replies?.length || message.replies.at(-1).fromWriter ? (
        <p className="sp-waiting">{t('support.waiting')}</p>
      ) : null}

      {children}
    </article>
  )
}
