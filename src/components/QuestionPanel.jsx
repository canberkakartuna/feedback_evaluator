import { useEffect, useRef, useState } from 'react'
import StatusMark from './StatusMark'
import { MARKS, SELF_MARKS } from '../lib/status'
import { answerKey } from '../lib/evaluate'
import {
  MODES,
  boardFile,
  contentSummary,
  describeContent,
  hasContent,
  modeLabel,
  uploadedFiles,
} from '../lib/answer'
import { ACCEPT, formatBytes, isImage, partitionFiles } from '../lib/attachments'
import Whiteboard from './Whiteboard'
import './QuestionPanel.css'

export default function QuestionPanel({
  question,
  state,
  position,
  previous,
  next,
  onSelfMark,
  onDraftChange,
  onModeChange,
  onAttach,
  onDetach,
  onSaveBoard,
  onCheck,
  onAskHint,
  onStep,
  onOpenTutor,
}) {
  const sheet = useRef(null)
  const [dragging, setDragging] = useState(false)
  const [rejected, setRejected] = useState([])
  const [boardOpen, setBoardOpen] = useState(false)
  const [pendingMode, setPendingMode] = useState(null)

  const files = uploadedFiles(state)
  const board = boardFile(state)
  const { feedback } = state
  const stale = Boolean(feedback) && state.feedbackFor !== answerKey(state)

  useEffect(() => {
    sheet.current?.scrollTo({ top: 0 })
    setRejected([])
    setBoardOpen(false)
    setPendingMode(null)
  }, [question.id])

  const takeFiles = (fileList) => {
    const { accepted, rejected: refused } = partitionFiles(Array.from(fileList ?? []))
    setRejected(refused)
    if (accepted.length) onAttach(accepted)
  }

  /** Paste an image straight in — only while Upload is the chosen method. */
  useEffect(() => {
    if (state.mode !== 'upload') return

    const onPaste = (event) => {
      if (event.clipboardData?.files.length) takeFiles(event.clipboardData.files)
    }

    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.mode])

  /** Ask before a switch throws work away; switch straight off if empty. */
  const requestMode = (next) => {
    if (next === state.mode) return
    setRejected([])

    if (hasContent(state)) {
      setPendingMode(next)
      return
    }

    setPendingMode(null)
    onModeChange(next)
  }

  return (
    <>
      <header className="qp-bar">
        <div className="qp-measure qp-bar-inner">
          <div className="qp-bar-meta">
            <span className="eyebrow">{question.groupTitle}</span>
            <p className="qp-bar-line">
              <span className="qp-code mono">{question.code}</span>
              <span className="qp-sep" aria-hidden="true" />
              <span className="qp-kind">{question.kind}</span>
              {question.points ? (
                <>
                  <span className="qp-sep" aria-hidden="true" />
                  <span className="mono">{question.points} marks</span>
                </>
              ) : null}
            </p>
          </div>

          <div className="qp-bar-right">
            <span className="qp-state" style={{ color: MARKS[state.selfMark ?? state.status].tone }}>
              <StatusMark status={state.selfMark ?? state.status} size={12} />
              {MARKS[state.selfMark ?? state.status].short}
            </span>
            <span
              className="qp-place mono"
              aria-label={`Question ${position.current} of ${position.total}`}
            >
              {position.current}/{position.total}
            </span>
            <button type="button" className="qp-tutor-toggle" onClick={onOpenTutor}>
              Tutor
            </button>
          </div>
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
              <span className="eyebrow">Your answer</span>
              <span className="qp-words mono">{contentSummary(state)}</span>
            </div>

            {/* One answer per question: choosing a method replaces the others. */}
            <div className="qp-modes" role="group" aria-label="How to answer">
              {MODES.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className="qp-mode"
                  aria-pressed={state.mode === option.id}
                  onClick={() => requestMode(option.id)}
                >
                  <span className="qp-mode-label">{option.label}</span>
                  <span className="qp-mode-hint mono">{option.hint}</span>
                </button>
              ))}
            </div>

            {pendingMode ? (
              <div className="qp-mode-warn" role="alert">
                <p className="qp-mode-warn-text">
                  Switching to {modeLabel(pendingMode)} discards {describeContent(state)}.
                </p>
                <div className="qp-mode-warn-actions">
                  <button
                    type="button"
                    className="qp-btn qp-btn-danger"
                    onClick={() => {
                      onModeChange(pendingMode)
                      setPendingMode(null)
                    }}
                  >
                    Discard and switch
                  </button>
                  <button type="button" className="qp-btn" onClick={() => setPendingMode(null)}>
                    Keep my answer
                  </button>
                </div>
              </div>
            ) : null}

            {state.mode === 'write' ? (
              <>
                <label className="sr-only" htmlFor="answer">
                  Your written answer
                </label>
                <textarea
                  id="answer"
                  className="qp-answer"
                  value={state.draft}
                  spellCheck="true"
                  placeholder={
                    question.rubric.length
                      ? 'Write your answer here. The tutor marks it against the rubric, not against a model answer.'
                      : 'Write what you have tried so far, and the tutor will work through it with you.'
                  }
                  onChange={(event) => onDraftChange(event.target.value)}
                />
                {question.workingExpected ? (
                  <p className="qp-mode-nudge">
                    This one is normally worked out by hand — Draw or Upload usually suits it better.
                  </p>
                ) : null}
              </>
            ) : null}

            {state.mode === 'draw' ? (
              <div className="qp-board">
                <button type="button" className="qp-way" onClick={() => setBoardOpen(true)}>
                  {board ? (
                    <img className="qp-board-thumb" src={board.url} alt="Your whiteboard so far" />
                  ) : null}
                  <span className="qp-way-text">
                    <span className="qp-way-main">
                      {state.strokes.length ? 'Edit your whiteboard' : 'Draw on the whiteboard'}
                    </span>
                    <span className="qp-way-sub mono">
                      {state.strokes.length
                        ? `${state.strokes.length} ${state.strokes.length === 1 ? 'stroke' : 'strokes'} · saved as ${board ? formatBytes(board.size) : 'a PNG'}`
                        : 'Squared paper · pen, eraser, undo'}
                    </span>
                  </span>
                </button>
              </div>
            ) : null}

            {state.mode === 'upload' ? (
              <div className="qp-upload">
                <label
                  className="qp-way"
                  data-dragging={dragging || undefined}
                  onDragOver={(event) => {
                    event.preventDefault()
                    setDragging(true)
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(event) => {
                    event.preventDefault()
                    setDragging(false)
                    takeFiles(event.dataTransfer.files)
                  }}
                >
                  <input
                    type="file"
                    className="sr-only"
                    multiple
                    accept={ACCEPT}
                    onChange={(event) => {
                      takeFiles(event.target.files)
                      event.target.value = ''
                    }}
                  />
                  <span className="qp-way-text">
                    <span className="qp-way-main">Add a photo or a file</span>
                    <span className="qp-way-sub mono">
                      Drop one here or paste it · JPG, PNG or PDF · 10 MB
                    </span>
                  </span>
                </label>

                {rejected.length ? (
                  <p className="qp-drop-error" role="alert">
                    Not added: {rejected.map((file) => `${file.name} ${file.reason}`).join('; ')}.
                    Fix the file and attach it again.
                  </p>
                ) : null}

                {files.length ? (
                  <ul className="qp-files">
                    {files.map((file) => (
                      <li key={file.id} className="qp-file">
                        <a
                          className="qp-file-thumb"
                          href={file.url}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`Open ${file.name} in a new tab`}
                        >
                          {isImage(file.type) ? (
                            <img src={file.url} alt="" />
                          ) : (
                            <span className="mono">PDF</span>
                          )}
                        </a>

                        <span className="qp-file-meta">
                          <span className="qp-file-name">{file.name}</span>
                          <span className="qp-file-size mono">{formatBytes(file.size)}</span>
                        </span>

                        <button
                          type="button"
                          className="qp-file-remove"
                          onClick={() => onDetach(file.id)}
                        >
                          Remove<span className="sr-only"> {file.name}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}

            <div className="qp-actions">
              {question.rubric.length ? (
                <button type="button" className="qp-btn qp-btn-primary" onClick={onCheck}>
                  Check my answer
                </button>
              ) : null}
              <button type="button" className="qp-btn" onClick={onAskHint}>
                Get a hint
              </button>
              {stale ? <p className="qp-stale">Edited since it was marked — check again.</p> : null}
            </div>
          </section>

          {/* Doc item 2: the student's own read of how it went. */}
          <section className="qp-selfmark">
            <span className="eyebrow">How did this one go?</span>
            <div className="qp-selfmark-row">
              {SELF_MARKS.map((key) => (
                <button
                  key={key}
                  type="button"
                  className="qp-selfmark-btn"
                  data-mark={key}
                  aria-pressed={state.selfMark === key}
                  onClick={() => onSelfMark(state.selfMark === key ? null : key)}
                >
                  <StatusMark status={key} size={12} />
                  {MARKS[key].label}
                </button>
              ))}
            </div>
          </section>

          {feedback ? (
            <section
              className="qp-feedback"
              aria-live="polite"
              data-verdict={feedback.markable ? feedback.verdict : 'pending'}
            >
              <div className="qp-stamp">
                <span className="qp-stamp-score mono">
                  {feedback.markable ? feedback.earned : '—'}
                  <span className="qp-stamp-slash">/</span>
                  {feedback.total}
                </span>
                <span className="qp-stamp-label">
                  {feedback.markable
                    ? MARKS[feedback.verdict].label
                    : feedback.pending
                      ? 'With your teacher'
                      : 'Nothing to mark'}
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
                        {feedback.markable ? (criterion.met ? criterion.points : 0) : '—'}/
                        {criterion.points}
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

      {boardOpen ? (
        <Whiteboard
          question={question}
          initialStrokes={state.strokes}
          onSave={(strokes, file) => {
            onSaveBoard(strokes, file)
            setBoardOpen(false)
          }}
          onClose={() => setBoardOpen(false)}
        />
      ) : null}

      <footer className="qp-nav">
        <div className="qp-measure qp-nav-inner">
          <button type="button" className="qp-step" disabled={!previous} onClick={() => onStep(-1)}>
            <span aria-hidden="true">←</span>
            <span className="qp-step-text">
              <span className="qp-step-label">Previous</span>
              <span className="mono">{previous ? previous.code : '—'}</span>
            </span>
          </button>

          <button
            type="button"
            className="qp-step qp-step-next"
            disabled={!next}
            onClick={() => onStep(1)}
          >
            <span className="qp-step-text">
              <span className="qp-step-label">Next</span>
              <span className="mono">{next ? next.code : '—'}</span>
            </span>
            <span aria-hidden="true">→</span>
          </button>
        </div>
      </footer>
    </>
  )
}
