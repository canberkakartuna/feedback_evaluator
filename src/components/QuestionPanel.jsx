import { useEffect, useRef } from 'react'
import StatusMark from './StatusMark'
import { STATUS } from '../lib/status'
import { wordCount } from '../lib/evaluate'
import './QuestionPanel.css'

export default function QuestionPanel({
  question,
  state,
  position,
  previous,
  next,
  onDraftChange,
  onCheck,
  onAskHint,
  onStep,
  onOpenTutor,
}) {
  const sheet = useRef(null)
  const words = wordCount(state.draft)
  const { feedback } = state
  const stale = Boolean(feedback) && state.feedbackFor !== state.draft

  useEffect(() => {
    sheet.current?.scrollTo({ top: 0 })
  }, [question.id])

  return (
    <>
      <header className="qp-bar">
        <div className="qp-bar-meta">
          <span className="eyebrow">{question.groupTitle}</span>
          <p className="qp-bar-line">
            <span className="qp-code mono">{question.code}</span>
            <span className="qp-sep" aria-hidden="true" />
            <span className="qp-kind">{question.kind}</span>
            <span className="qp-sep" aria-hidden="true" />
            <span className="mono">{question.points} marks</span>
          </p>
        </div>

        <div className="qp-bar-right">
          <span className="qp-state" style={{ color: STATUS[state.status].tone }}>
            <StatusMark status={state.status} size={12} />
            {STATUS[state.status].short}
          </span>
          <span className="qp-place mono" aria-label={`Question ${position.current} of ${position.total}`}>
            {position.current}/{position.total}
          </span>
          <button type="button" className="qp-tutor-toggle" onClick={onOpenTutor}>
            Tutor
          </button>
        </div>
      </header>

      <div className="qp-scroll" ref={sheet}>
        <article className="qp-sheet">
          <p className="qp-prompt">{question.prompt}</p>

          {question.stimulus?.kind === 'table' ? (
            <figure className="qp-figure">
              <figcaption className="eyebrow">{question.stimulus.caption}</figcaption>
              <div className="qp-table-wrap">
                <table className="qp-table">
                  <thead>
                    <tr>
                      {question.stimulus.columns.map((column) => (
                        <th key={column} scope="col">
                          {column}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {question.stimulus.rows.map((row) => (
                      <tr key={row.join('|')}>
                        {row.map((cell, cellIndex) => (
                          <td key={cellIndex} className={cellIndex ? 'mono' : undefined}>
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </figure>
          ) : null}

          <section className="qp-answer-block">
            <div className="qp-answer-head">
              <label className="eyebrow" htmlFor="answer">
                Your answer
              </label>
              <span className="qp-words mono">
                {words} {words === 1 ? 'word' : 'words'}
              </span>
            </div>

            <textarea
              id="answer"
              className="qp-answer"
              value={state.draft}
              spellCheck="true"
              placeholder="Write your answer here. The tutor marks it against the rubric, not against a model answer."
              onChange={(event) => onDraftChange(event.target.value)}
            />

            <div className="qp-actions">
              <button type="button" className="qp-btn qp-btn-primary" onClick={onCheck}>
                Check my answer
              </button>
              <button type="button" className="qp-btn" onClick={onAskHint}>
                Get a hint
              </button>
              {stale ? <p className="qp-stale">Edited since it was marked — check again.</p> : null}
            </div>
          </section>

          {feedback ? (
            <section className="qp-feedback" aria-live="polite" data-verdict={feedback.verdict}>
              <div className="qp-stamp">
                <span className="qp-stamp-score mono">
                  {feedback.earned}<span className="qp-stamp-slash">/</span>{feedback.total}
                </span>
                <span className="qp-stamp-label">
                  {feedback.words < 8 ? 'Not yet markable' : STATUS[feedback.verdict].label}
                </span>
              </div>

              <div className="qp-feedback-body">
                <p className="qp-summary">{feedback.summary}</p>

                <ul className="qp-rubric">
                  {feedback.criteria.map((criterion) => (
                    <li key={criterion.id} className="qp-criterion" data-met={criterion.met}>
                      <span className="qp-criterion-mark" aria-hidden="true">
                        {criterion.met ? '✓' : '○'}
                      </span>
                      <span className="qp-criterion-label">{criterion.label}</span>
                      <span className="qp-criterion-points mono">
                        {criterion.met ? criterion.points : 0}/{criterion.points}
                      </span>
                    </li>
                  ))}
                </ul>

                {feedback.nextStep ? (
                  <p className="qp-next">
                    <span className="eyebrow">Do this next</span>
                    {feedback.nextStep}
                  </p>
                ) : null}
              </div>
            </section>
          ) : null}
        </article>
      </div>

      <footer className="qp-nav">
        <button type="button" className="qp-step" disabled={!previous} onClick={() => onStep(-1)}>
          <span aria-hidden="true">←</span>
          <span className="qp-step-text">
            <span className="qp-step-label">Previous</span>
            <span className="mono">{previous ? previous.code : '—'}</span>
          </span>
        </button>

        <button type="button" className="qp-step qp-step-next" disabled={!next} onClick={() => onStep(1)}>
          <span className="qp-step-text">
            <span className="qp-step-label">Next</span>
            <span className="mono">{next ? next.code : '—'}</span>
          </span>
          <span aria-hidden="true">→</span>
        </button>
      </footer>
    </>
  )
}
