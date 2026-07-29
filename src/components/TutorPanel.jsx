import { useEffect, useRef, useState } from 'react'
import './TutorPanel.css'

const ACTIONS = [
  { id: 'hint', label: 'Give me a hint' },
  { id: 'concept', label: 'Explain the concept' },
  { id: 'example', label: 'Worked example' },
  { id: 'review', label: 'Check my reasoning' },
]

export default function TutorPanel({ question, state, pending, open, onSend, onQuickAction, onClose }) {
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

  const hintsLeft = question.tutor.hints.length - state.hintsUsed

  const submit = (event) => {
    event.preventDefault()
    onSend(draft)
    setDraft('')
  }

  return (
    <>
      <header className="tp-head">
        <div>
          <p className="eyebrow">Tutor</p>
          <p className="tp-scope">
            Working on <span className="mono">{question.code}</span>
          </p>
        </div>
        <button type="button" className="tp-close" ref={closeButton} onClick={onClose}>
          Close
        </button>
      </header>

      <div className="tp-thread" ref={thread} aria-live="polite" aria-atomic="false">
        {state.messages.map((message) => (
          <article key={message.id} className="tp-msg" data-from={message.from} data-kind={message.kind}>
            {message.label ? <p className="tp-msg-label">{message.label}</p> : null}
            <p className="tp-msg-text">{message.text}</p>
          </article>
        ))}

        {pending ? (
          <article className="tp-msg" data-from="tutor">
            <p className="tp-typing" aria-label="The tutor is writing">
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
            key={action.id}
            type="button"
            className="tp-chip"
            disabled={pending}
            onClick={() => onQuickAction(action.id)}
          >
            {action.label}
            {action.id === 'hint' ? (
              <span className="tp-chip-count mono">{hintsLeft > 0 ? hintsLeft : 0}</span>
            ) : null}
          </button>
        ))}
      </div>

      <form className="tp-composer" onSubmit={submit}>
        <label className="sr-only" htmlFor="tutor-message">
          Message the tutor
        </label>
        <textarea
          id="tutor-message"
          className="tp-input"
          rows={1}
          value={draft}
          placeholder="Ask about this question…"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) submit(event)
          }}
        />
        <button type="submit" className="tp-send" disabled={!draft.trim()}>
          Send
        </button>
      </form>
    </>
  )
}
