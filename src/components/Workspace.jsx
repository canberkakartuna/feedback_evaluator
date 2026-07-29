import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { course, fallbackReplies, questions, seedState } from '../data/course'
import { answerKey, evaluateAnswer, wordCount } from '../lib/evaluate'
import { useMediaQuery } from '../lib/useMediaQuery'
import QuestionList from './QuestionList'
import QuestionPanel from './QuestionPanel'
import TutorPanel from './TutorPanel'
import './Workspace.css'

const REPLY_DELAY = 900
const DOCKED_TUTOR = '(min-width: 1180px)'

function initProgress() {
  const map = {}

  for (const question of questions) {
    const seed = seedState[question.id]

    const state = {
      status: seed?.status ?? 'new',
      draft: seed?.draft ?? '',
      attachments: seed?.attachments ? [...seed.attachments] : [],
      strokes: [],
      feedback: null,
      feedbackFor: null,
      hintsUsed: 0,
      unread: false,
      messages: [{ id: `${question.id}-opening`, from: 'tutor', text: question.tutor.opening }],
    }

    if (seed && seed.status !== 'draft') {
      state.feedback = evaluateAnswer(question, state.draft, state.attachments.length)
      state.feedbackFor = answerKey(state)
    }

    map[question.id] = state
  }

  return map
}

/** Seeded attachments are data URIs; only blob: URLs need revoking. */
function releaseUrl(url) {
  if (url.startsWith('blob:')) URL.revokeObjectURL(url)
}

export default function Workspace() {
  const [progress, setProgress] = useState(initProgress)
  const [activeId, setActiveId] = useState('bio-102')
  const [mobileView, setMobileView] = useState('problem')
  const [tutorOpen, setTutorOpen] = useState(false)
  const [tutorCollapsed, setTutorCollapsed] = useState(false)
  const [listCollapsed, setListCollapsed] = useState(false)
  const [pendingIds, setPendingIds] = useState([])

  const timers = useRef([])
  const seq = useRef(0)
  const nextId = () => `m${(seq.current += 1)}`

  const tutorIsDocked = useMediaQuery(DOCKED_TUTOR)

  const index = questions.findIndex((q) => q.id === activeId)
  const active = questions[index]
  const activeState = progress[activeId]

  const tutorVisible = tutorIsDocked ? !tutorCollapsed : mobileView === 'tutor' || tutorOpen

  const tally = useMemo(() => {
    const counts = { new: 0, draft: 0, revise: 0, mastered: 0 }
    for (const question of questions) counts[progress[question.id].status] += 1
    return counts
  }, [progress])

  /* Release every object URL and pending timer when the workspace goes away. */
  const latest = useRef(progress)
  latest.current = progress

  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout)
      for (const state of Object.values(latest.current)) {
        for (const file of state.attachments) releaseUrl(file.url)
      }
    },
    [],
  )

  /* ── state helpers ───────────────────────────────────────── */

  const patch = useCallback((id, fields) => {
    setProgress((prev) => ({ ...prev, [id]: { ...prev[id], ...fields } }))
  }, [])

  const append = useCallback((id, message) => {
    setProgress((prev) => ({
      ...prev,
      [id]: { ...prev[id], messages: [...prev[id].messages, message] },
    }))
  }, [])

  /** Queue a tutor reply. Replies land in the thread they were asked in,
   *  even if the student has moved on to another question. */
  const respond = useCallback((id, message) => {
    setPendingIds((prev) => [...prev, id])

    const timer = setTimeout(() => {
      setProgress((prev) => ({
        ...prev,
        [id]: { ...prev[id], messages: [...prev[id].messages, message], unread: true },
      }))
      setPendingIds((prev) => prev.filter((pending) => pending !== id))
    }, REPLY_DELAY)

    timers.current.push(timer)
  }, [])

  /* ── actions ─────────────────────────────────────────────── */

  const selectQuestion = useCallback((id) => {
    setActiveId(id)
    setMobileView('problem')
  }, [])

  const step = useCallback(
    (delta) => {
      const next = questions[index + delta]
      if (next) selectQuestion(next.id)
    },
    [index, selectQuestion],
  )

  const setDraft = useCallback((text) => patch(activeId, { draft: text }), [activeId, patch])

  const attach = useCallback(
    (files) => {
      if (!files.length) return

      patch(activeId, {
        attachments: [
          ...progress[activeId].attachments,
          ...files.map((file) => ({
            id: `f${(seq.current += 1)}`,
            name: file.name,
            size: file.size,
            type: file.type,
            url: URL.createObjectURL(file),
            source: 'file',
          })),
        ],
      })
    },
    [activeId, patch, progress],
  )

  /**
   * A board is one attachment, not a growing pile: saving replaces the
   * previous export. Saving an empty board removes it.
   */
  const saveBoard = useCallback(
    (strokes, image) => {
      const kept = progress[activeId].attachments.filter((item) => {
        if (item.source !== 'whiteboard') return true
        releaseUrl(item.url)
        return false
      })

      patch(activeId, {
        strokes,
        attachments: image
          ? [...kept, { id: `f${(seq.current += 1)}`, ...image, source: 'whiteboard' }]
          : kept,
      })
    },
    [activeId, patch, progress],
  )

  const detach = useCallback(
    (fileId) => {
      const { attachments } = progress[activeId]
      const target = attachments.find((file) => file.id === fileId)
      if (target) releaseUrl(target.url)

      patch(activeId, { attachments: attachments.filter((file) => file.id !== fileId) })
    },
    [activeId, patch, progress],
  )

  const checkAnswer = useCallback(() => {
    const attachmentCount = activeState.attachments.length
    const feedback = evaluateAnswer(active, activeState.draft, attachmentCount)

    patch(active.id, {
      feedback,
      feedbackFor: answerKey(activeState),
      status: feedback.markable
        ? feedback.verdict
        : attachmentCount
          ? 'draft'
          : activeState.status,
    })

    if (feedback.markable) {
      append(active.id, {
        id: nextId(),
        from: 'tutor',
        kind: 'note',
        text:
          feedback.verdict === 'mastered'
            ? `Marked ${active.code} — ${feedback.earned} of ${feedback.total}. Full marks, and in the right order.`
            : `Marked ${active.code} — ${feedback.earned} of ${feedback.total}. ${feedback.nextStep}`,
      })
    }
  }, [active, activeState, append, patch])

  const send = useCallback(
    (text) => {
      const trimmed = text.trim()
      if (!trimmed) return

      append(active.id, { id: nextId(), from: 'student', text: trimmed })
      respond(active.id, {
        id: nextId(),
        from: 'tutor',
        text: fallbackReplies[wordCount(trimmed) % fallbackReplies.length],
      })
    },
    [active, append, respond],
  )

  const quickAction = useCallback(
    (kind) => {
      const { tutor, code } = active
      const state = progress[active.id]
      let ask
      let reply

      if (kind === 'hint') {
        const used = state.hintsUsed
        ask = used === 0 ? 'Give me a hint.' : 'Another hint, please.'

        if (used >= tutor.hints.length) {
          reply = {
            text: `That was the last hint for ${code}. Write what you have and press Check my answer — I will mark it against the rubric and name what is missing.`,
          }
        } else {
          reply = { label: `Hint ${used + 1} of ${tutor.hints.length}`, text: tutor.hints[used] }
          patch(active.id, { hintsUsed: used + 1 })
        }
      } else if (kind === 'concept') {
        ask = 'Explain the concept behind this.'
        reply = { label: 'The concept', text: tutor.concept }
      } else if (kind === 'example') {
        ask = 'Show me a worked example.'
        reply = { label: 'Worked example', text: tutor.example }
      } else {
        ask = 'Check my reasoning.'

        if (wordCount(state.draft) >= 4) {
          reply = { label: 'Watch for this', text: tutor.misconception }
        } else if (state.attachments.length) {
          reply = {
            text: 'I can see your working is attached. Write the explanation out as well — the marks are given for the reasoning in words, and I can only check what you write.',
          }
        } else {
          reply = {
            text: 'There is nothing in your answer box yet. Write a sentence or two and I will read it back to you.',
          }
        }
      }

      append(active.id, { id: nextId(), from: 'student', text: ask })
      respond(active.id, { id: nextId(), from: 'tutor', ...reply })
    },
    [active, append, patch, progress, respond],
  )

  const revealTutor = useCallback(() => {
    setTutorCollapsed(false)
    setTutorOpen(true)
    setMobileView('tutor')
  }, [])

  const askForHint = useCallback(() => {
    revealTutor()
    quickAction('hint')
  }, [quickAction, revealTutor])

  /* ── panel plumbing ──────────────────────────────────────── */

  useEffect(() => {
    if (tutorVisible && progress[activeId].unread) patch(activeId, { unread: false })
  }, [activeId, patch, progress, tutorVisible])

  useEffect(() => {
    if (!tutorOpen) return
    const onKey = (event) => event.key === 'Escape' && setTutorOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tutorOpen])

  const unreadCount = questions.filter((q) => progress[q.id].unread).length

  const tabs = [
    { id: 'list', label: 'Questions', meta: `${tally.mastered}/${questions.length}` },
    { id: 'problem', label: 'Problem', meta: active.code },
    { id: 'tutor', label: 'Tutor', dot: unreadCount > 0 },
  ]

  return (
    <div
      className="ws"
      data-view={mobileView}
      data-drawer={tutorOpen ? 'open' : 'closed'}
      data-tutor={tutorCollapsed ? 'collapsed' : 'expanded'}
      data-list={listCollapsed ? 'collapsed' : 'expanded'}
    >
      <aside className="ws-pane ws-list" aria-label="Question set">
        <button
          type="button"
          className="ws-rail"
          aria-expanded={false}
          onClick={() => setListCollapsed(false)}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M3 3v8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            <path
              d="M6.5 3.5 10 7l-3.5 3.5"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="ws-rail-label">Questions</span>
          <span className="ws-rail-count mono">
            {tally.mastered}/{questions.length}
          </span>
          <span className="sr-only">Show questions</span>
        </button>

        <div className="ws-list-inner">
          <QuestionList
            course={course}
            progress={progress}
            activeId={activeId}
            tally={tally}
            onSelect={selectQuestion}
            onCollapse={() => setListCollapsed(true)}
          />
        </div>
      </aside>

      <main className="ws-pane ws-problem">
        <QuestionPanel
          question={active}
          state={activeState}
          position={{ current: index + 1, total: questions.length }}
          previous={questions[index - 1]}
          next={questions[index + 1]}
          onDraftChange={setDraft}
          onAttach={attach}
          onDetach={detach}
          onSaveBoard={saveBoard}
          onCheck={checkAnswer}
          onAskHint={askForHint}
          onStep={step}
          onOpenTutor={revealTutor}
        />
      </main>

      <button
        type="button"
        className="ws-scrim"
        tabIndex={tutorOpen ? 0 : -1}
        aria-label="Close tutor"
        onClick={() => setTutorOpen(false)}
      />

      <aside className="ws-pane ws-tutor" aria-label="AI tutor">
        <button
          type="button"
          className="ws-rail"
          aria-expanded={false}
          onClick={() => setTutorCollapsed(false)}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path
              d="M8 3.5 4.5 7 8 10.5"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path d="M11 3v8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <span className="ws-rail-label">Tutor</span>
          {unreadCount > 0 ? <span className="ws-rail-dot" aria-hidden="true" /> : null}
          <span className="sr-only">
            Show tutor{unreadCount > 0 ? ', new reply waiting' : ''}
          </span>
        </button>

        <div className="ws-tutor-inner">
          <TutorPanel
            question={active}
            state={activeState}
            pending={pendingIds.includes(activeId)}
            open={tutorOpen}
            onSend={send}
            onQuickAction={quickAction}
            onClose={() => setTutorOpen(false)}
            onCollapse={() => setTutorCollapsed(true)}
          />
        </div>
      </aside>

      <nav className="ws-tabs" aria-label="Switch panel">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className="ws-tab"
            aria-current={mobileView === tab.id}
            onClick={() => setMobileView(tab.id)}
          >
            <span className="ws-tab-label">{tab.label}</span>
            {tab.meta ? <span className="ws-tab-meta mono">{tab.meta}</span> : null}
            {tab.dot ? <span className="ws-tab-dot" aria-label="New reply" /> : null}
          </button>
        ))}
      </nav>
    </div>
  )
}
