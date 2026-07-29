import StatusMark from './StatusMark'
import { STATUS } from '../lib/status'
import './QuestionList.css'

export default function QuestionList({ course, progress, activeId, tally, onSelect, onCollapse }) {
  const total = course.groups.reduce((sum, group) => sum + group.questions.length, 0)

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
            {tally.mastered} of {total}
          </span>{' '}
          mastered
        </p>

        <ol className="ql-spine" aria-hidden="true">
          {course.groups.flatMap((group) =>
            group.questions.map((question) => (
              <li
                key={question.id}
                className="ql-spine-mark"
                data-status={progress[question.id].status}
                data-active={question.id === activeId}
              />
            )),
          )}
        </ol>
      </header>

      <div className="ql-scroll">
        {course.groups.map((group) => (
          <section key={group.id} className="ql-group">
            <h2 className="ql-group-head">
              <span className="eyebrow">{group.title}</span>
              <span className="ql-group-count mono">{group.questions.length}</span>
            </h2>

            <ul className="ql-rows">
              {group.questions.map((question) => {
                const state = progress[question.id]
                const meta = STATUS[state.status]
                const selected = question.id === activeId

                return (
                  <li key={question.id}>
                    <button
                      type="button"
                      className="ql-row"
                      aria-current={selected}
                      onClick={() => onSelect(question.id)}
                    >
                      <StatusMark status={state.status} />

                      <span className="ql-row-body">
                        <span className="ql-row-top">
                          <span className="ql-code mono">{question.code}</span>
                          <span className="ql-points mono">{question.points} pts</span>
                        </span>
                        <span className="ql-row-prompt">{question.prompt}</span>
                        <span className="ql-row-state" style={{ color: meta.tone }}>
                          {state.feedback && state.status !== 'new'
                            ? `${meta.short} · ${state.feedback.earned}/${state.feedback.total}`
                            : meta.label}
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
      </div>

      <footer className="ql-foot">
        <ul className="ql-key">
          {Object.entries(STATUS).map(([status, meta]) => (
            <li key={status} className="ql-key-item">
              <StatusMark status={status} size={12} />
              <span>{meta.short}</span>
            </li>
          ))}
        </ul>
      </footer>
    </>
  )
}
