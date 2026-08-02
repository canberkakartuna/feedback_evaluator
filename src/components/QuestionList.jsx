import { useState } from 'react'
import StatusMark from './StatusMark'
import { AUTO_MARKS, MARKS } from '../lib/status'
import './QuestionList.css'

export default function QuestionList({
  course,
  groups,
  progress,
  activeId,
  tally,
  onSelect,
  onAskOwn,
  onCollapse,
  onWithdraw,
}) {
  const [ownDraft, setOwnDraft] = useState('')

  const askOwn = (event) => {
    event.preventDefault()
    if (!ownDraft.trim()) return
    onAskOwn(ownDraft)
    setOwnDraft('')
  }

  /** What the student said, or what the checker found. */
  const rowMark = (state) => {
    if (state.selfMark) return MARKS[state.selfMark]
    return MARKS[state.status]
  }

  const rowNote = (state) => {
    if (state.selfMark) return MARKS[state.selfMark].label
    if (state.feedback?.pending) return 'With your teacher'
    if (state.feedback?.markable && state.status !== 'new') {
      return `${MARKS[state.status].short} · ${state.feedback.earned}/${state.feedback.total}`
    }
    return MARKS[state.status].label
  }

  return (
    <>
      <header className="ql-head">
        <div className="ql-head-top">
          <div className="ql-head-name">
            <p className="eyebrow">{course.subtitle}</p>
            <h1 className="ql-title">{course.title}</h1>
          </div>

          <button
            type="button"
            className="ql-collapse"
            aria-label="Hide questions"
            title="Hide questions"
            onClick={onCollapse}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path
                d="M9.5 3.5 6 7l3.5 3.5"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path d="M3 3v8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <p className="ql-count">
          <span className="mono">
            {tally.done} of {tally.total}
          </span>{' '}
          marked done
        </p>

        <ol className="ql-spine" aria-hidden="true">
          {groups.flatMap((group) =>
            group.questions.map((question) => (
              <li
                key={question.id}
                className="ql-spine-mark"
                data-shape={rowMark(progress[question.id]).shape}
                data-active={question.id === activeId}
              />
            )),
          )}
        </ol>
      </header>

      <div className="ql-scroll">
        {groups.map((group) => (
          <section key={group.id} className="ql-group">
            <h2 className="ql-group-head">
              <span className="eyebrow">{group.title}</span>
              <span className="ql-group-count mono">{group.questions.length}</span>
            </h2>

            <ul className="ql-rows">
              {group.questions.map((question) => {
                const state = progress[question.id]
                const mark = rowMark(state)
                const selected = question.id === activeId

                return (
                  <li key={question.id}>
                    <button
                      type="button"
                      className="ql-row"
                      aria-current={selected}
                      onClick={() => onSelect(question.id)}
                    >
                      <StatusMark status={state.selfMark ?? state.status} />

                      <span className="ql-row-body">
                        <span className="ql-row-top">
                          <span className="ql-code mono">{question.code}</span>
                          {question.points ? (
                            <span className="ql-points mono">{question.points} pts</span>
                          ) : null}
                        </span>
                        <span className="ql-row-prompt">{question.prompt}</span>
                        <span className="ql-row-state" style={{ color: mark.tone }}>
                          {rowNote(state)}
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        ))}

        {/* Doc item 8: what they ask unprompted shows where they actually stall. */}
        <section className="ql-group ql-own">
          <h2 className="ql-group-head">
            <span className="eyebrow">Ask your own</span>
          </h2>

          <form className="ql-own-form" onSubmit={askOwn}>
            <label className="sr-only" htmlFor="own-question">
              Your own question
            </label>
            <textarea
              id="own-question"
              className="ql-own-input"
              rows={3}
              value={ownDraft}
              placeholder="Stuck on something else? Type that question here and work on it with the tutor."
              onChange={(event) => setOwnDraft(event.target.value)}
            />
            <button type="submit" className="ql-own-btn" disabled={!ownDraft.trim()}>
              Add to my list
            </button>
          </form>
        </section>
      </div>

      <footer className="ql-foot">
        <ul className="ql-key">
          {AUTO_MARKS.map((key) => (
            <li key={key} className="ql-key-item">
              <StatusMark status={key} size={12} />
              <span>{MARKS[key].short}</span>
            </li>
          ))}
        </ul>

        {/* The withdrawal half of consent, where the student actually is
            rather than in a policy page they will never open. */}
        {onWithdraw ? (
          <button type="button" className="ql-withdraw" onClick={onWithdraw}>
            Delete everything I did
          </button>
        ) : null}
      </footer>
    </>
  )
}
