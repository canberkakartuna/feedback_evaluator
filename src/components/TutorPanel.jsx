import { useEffect, useRef, useState } from 'react'
import { useT } from '../lib/i18n'
import './TutorPanel.css'

/** Ids the server understands; the words come from `tp.*Action` in strings.js. */
const ACTIONS = ['hint', 'concept', 'example', 'review']

export default function TutorPanel({
  question,
  state,
  pending,
  open,
  onSend,
  onQuickAction,
  onRate,
  onClose,
  onCollapse,
}) {
  const t = useT()
  const [draft, setDraft] = useState('')
  const thread = useRef(null)
  const closeButton = useRef(null)

  useEffect(() => {
    const node = thread.current
    if (node) node.scrollTop = node.scrollHeight
  }, [state.messages, pending, question.id])

  useEffect(() => {
    if (open) closeButton.current?.focus()
  }, [open])

  const hintsLeft = (question.hintCount ?? 0) - state.hintsUsed

  const submit = (event) => {
    event.preventDefault()
    onSend(draft)
    setDraft('')
  }

  return (
    <>
      <header className="tp-head">
        <div>
          <p className="eyebrow">{t('tp.tutor')}</p>
          <p className="tp-scope">
            {t('tp.workingOn')} <span className="mono">{question.code}</span>
          </p>
        </div>
        <div className="tp-head-actions">
          <button
            type="button"
            className="tp-collapse"
            aria-label={t('tp.hide')}
            title={t('tp.hide')}
            onClick={onCollapse}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path
                d="M3 3.5 6.5 7 3 10.5"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path d="M11 3v8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>

          <button type="button" className="tp-close" ref={closeButton} onClick={onClose}>
            {t('tp.close')}
          </button>
        </div>
      </header>

      <div className="tp-thread" ref={thread} aria-live="polite" aria-atomic="false">
        {state.messages.map((message) => (
          <article key={message.id} className="tp-msg" data-from={message.from} data-kind={message.kind}>
            {message.label ? <p className="tp-msg-label">{message.label}</p> : null}
            {/* An opening line nobody authored is chrome, so it is said here and
                follows the language switch. Everything else in this thread is
                either the student's own words or a reply written against what a
                teacher authored, and is shown exactly as it came. */}
            <p className="tp-msg-text">
              {message.text || (message.kind === 'opening' ? t('tp.opening') : null)}
            </p>

            {/* Doc item 5: was this feedback any use? */}
            {message.kind === 'reply' ? (
              <p className="tp-rate">
                {state.ratings[message.id] ? (
                  <span className="tp-rate-done mono">
                    {state.ratings[message.id] === 'up' ? t('tp.helpful') : t('tp.notHelpful')}
                  </span>
                ) : (
                  <>
                    <span className="tp-rate-ask mono">{t('tp.didThisHelp')}</span>
                    <button
                      type="button"
                      className="tp-rate-btn"
                      onClick={() => onRate(message.id, 'up')}
                    >
                      {t('tp.yes')}
                    </button>
                    <button
                      type="button"
                      className="tp-rate-btn"
                      onClick={() => onRate(message.id, 'down')}
                    >
                      {t('tp.no')}
                    </button>
                  </>
                )}
              </p>
            ) : null}
          </article>
        ))}

        {pending ? (
          <article className="tp-msg" data-from="tutor">
            <p className="tp-typing" aria-label={t('tp.writing')}>
              <i />
              <i />
              <i />
            </p>
          </article>
        ) : null}
      </div>

      <div className="tp-actions">
        {ACTIONS.map((action) => (
          <button
            key={action}
            type="button"
            className="tp-chip"
            disabled={pending}
            onClick={() => onQuickAction(action)}
          >
            {t(`tp.${action}Action`)}
            {action === 'hint' ? (
              <span className="tp-chip-count mono">{hintsLeft > 0 ? hintsLeft : 0}</span>
            ) : null}
          </button>
        ))}
      </div>

      <form className="tp-composer" onSubmit={submit}>
        <label className="sr-only" htmlFor="tutor-message">
          {t('tp.messageLabel')}
        </label>
        <textarea
          id="tutor-message"
          className="tp-input"
          rows={1}
          value={draft}
          placeholder={t('tp.placeholder')}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) submit(event)
          }}
        />
        <button type="submit" className="tp-send" disabled={!draft.trim()}>
          {t('tp.send')}
        </button>
      </form>
    </>
  )
}
