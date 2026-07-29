import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { course, fallbackReplies, ownTutor, questions, seedState } from '../data/course'
import { answerKey, evaluateAnswer, wordCount } from '../lib/evaluate'
import { DEFAULT_MODE, hasContent } from '../lib/answer'
import { useMediaQuery } from '../lib/useMediaQuery'
import QuestionList from './QuestionList'
import QuestionPanel from './QuestionPanel'
import TutorPanel from './TutorPanel'
import './Workspace.css'

const REPLY_DELAY = 900
const DOCKED_TUTOR = '(min-width: 1180px)'

function blankState(question, seed) {
  return {
    mode: seed?.mode ?? DEFAULT_MODE,
    status: seed?.status ?? 'new',
    selfMark: seed?.selfMark ?? null,
    draft: seed?.draft ?? '',
    attachments: seed?.attachments ? [...seed.attachments] : [],
    strokes: [],
    feedback: null,
    feedbackFor: null,
    hintsUsed: 0,
    unread: false,
    ratings: {},
    messages: [{ id: `${question.id}-opening`, from: 'tutor', text: question.tutor.opening }],
  }
}

function initProgress() {
  const map = {}

  for (const question of questions) {
    const seed = seedState[question.id]
    const state = blankState(question, seed)

    if (seed && seed.status !== 'draft') {
      state.feedback = evaluateAnswer(question, state)
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

export default function Workspace({ topicId = 'all' }) {
  const [progress, setProgress] = useState(initProgress)
  const [ownQuestions, setOwnQuestions] = useState([])
  const [activeId, setActiveId] = useState(
    () => questions.find((q) => topicId === 'all' || q.groupId === topicId)?.id ?? questions[0].id,
  )
  const [mobileView, setMobileView] = useState('problem')
  const [tutorOpen, setTutorOpen] = useState(false)
  const [tutorCollapsed, setTutorCollapsed] = useState(false)
  const [listCollapsed, setListCollapsed] = useState(false)
  const [pendingIds, setPendingIds] = useState([])

  const timers = useRef([])
  const seq = useRef(0)
  const nextId = () => `m${(seq.current += 1)}`

  const tutorIsDocked = useMediaQuery(DOCKED_TUTOR)

  /* The chosen topic, plus anything the student added themselves. */
  const visibleGroups = useMemo(() => {
    const chosen =
      topicId === 'all' ? course.groups : course.groups.filter((group) => group.id === topicId)

    return ownQuestions.length
      ? [
          ...chosen,
          { id: 'own', title: 'Your own questions', questions: ownQuestions },
        ]
      : chosen
  }, [ownQuestions, topicId])

  const visible = useMemo(
    () => visibleGroups.flatMap((group) => group.questions),
    [visibleGroups],
  )

  const index = visible.findIndex((q) => q.id === activeId)
  const active = visible[index] ?? visible[0]
  const activeState = progress[active.id]

  const tutorVisible = tutorIsDocked ? !tutorCollapsed : mobileView === 'tutor' || tutorOpen

  /* Progress counts what the student marked, falling back to the auto check. */
  const tally = useMemo(() => {
    let done = 0
    for (const question of visible) {
      const state = progress[question.id]
      if (state.selfMark === 'done' || (!state.selfMark && state.status === 'mastered')) done += 1
    }
    return { done, total: visible.length }
  }, [progress, visible])

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
      const next = visible[index + delta]
      if (next) selectQuestion(next.id)
    },
    [index, selectQuestion, visible],
  )

  /** Doc item 2: the student marks their own progress; green, yellow or red. */
  const setSelfMark = useCallback(
    (mark) => patch(activeId, { selfMark: mark }),
    [activeId, patch],
  )

  /** Doc item 5: feedback on the feedback. */
  const rateMessage = useCallback(
    (messageId, value) => {
      setProgress((prev) => ({
        ...prev,
        [activeId]: {
          ...prev[activeId],
          ratings: { ...prev[activeId].ratings, [messageId]: value },
        },
      }))
    },
    [activeId],
  )

  /** Doc item 8: their own question, which is itself a finding. */
  const addOwnQuestion = useCallback(
    (prompt) => {
      const text = prompt.trim()
      if (!text) return

      const count = ownQuestions.length + 1
      const question = {
        id: `own-${count}`,
        code: `OWN-${String(count).padStart(2, '0')}`,
        kind: 'Your question',
        points: 0,
        prompt: text,
        rubric: [],
        tutor: ownTutor,
        own: true,
        groupId: 'own',
        groupTitle: 'Your own questions',
      }

      setOwnQuestions((prev) => [...prev, question])
      setProgress((prev) => ({ ...prev, [question.id]: blankState(question) }))
      setActiveId(question.id)
      setMobileView('problem')
    },
    [ownQuestions.length],
  )

  const setDraft = useCallback((text) => patch(activeId, { draft: text }), [activeId, patch])

  /**
   * Switching answer method discards whatever the old one held, so a question
   * never carries two answers. The panel confirms first when there is content.
   */
  const setMode = useCallback(
    (mode) => {
      const state = progress[activeId]
      if (mode === state.mode) return

      if (!hasContent(state)) {
        patch(activeId, { mode })
        return
      }

      const cleared = { draft: state.draft, strokes: state.strokes, attachments: state.attachments }

      if (state.mode === 'write') {
        cleared.draft = ''
      } else if (state.mode === 'draw') {
        cleared.strokes = []
        cleared.attachments = state.attachments.filter((item) => {
          if (item.source !== 'whiteboard') return true
          releaseUrl(item.url)
          return false
        })
      } else {
        cleared.attachments = state.attachments.filter((item) => {
          if (item.source === 'whiteboard') return true
          releaseUrl(item.url)
          return false
        })
      }

      // The old mark described work that no longer exists.
      patch(activeId, { mode, ...cleared, feedback: null, feedbackFor: null, status: 'new' })
    },
    [activeId, patch, progress],
  )

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
    const feedback = evaluateAnswer(active, activeState)

    patch(active.id, {
      feedback,
      feedbackFor: answerKey(activeState),
      status: feedback.markable ? feedback.verdict : feedback.pending ? 'draft' : activeState.status,
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
    } else if (feedback.pending) {
      append(active.id, {
        id: nextId(),
        from: 'tutor',
        kind: 'note',
        text: `${active.code} is with your teacher to mark by hand. I cannot score a drawing or a photo.`,
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
        kind: 'reply',
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

        if (state.mode === 'write' && wordCount(state.draft) >= 4) {
          reply = { label: 'Watch for this', text: tutor.misconception }
        } else if (hasContent(state)) {
          reply = {
            text: 'I cannot read a drawing or a photo yet, so I cannot check that working directly. Talk me through your reasoning here and I will tell you where it goes wrong.',
          }
        } else {
          reply = {
            text: 'There is nothing to check yet. Put something in your answer and I will read it back to you.',
          }
        }
      }

      append(active.id, { id: nextId(), from: 'student', text: ask })
      respond(active.id, { id: nextId(), from: 'tutor', kind: 'reply', ...reply })
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

  /* Keep the selection inside the visible set. */
  useEffect(() => {
    if (!visible.some((question) => question.id === activeId)) setActiveId(visible[0].id)
  }, [activeId, visible])

  useEffect(() => {
    if (tutorVisible && progress[activeId].unread) patch(activeId, { unread: false })
  }, [activeId, patch, progress, tutorVisible])

  useEffect(() => {
    if (!tutorOpen) return
    const onKey = (event) => event.key === 'Escape' && setTutorOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tutorOpen])

  const unreadCount = visible.filter((q) => progress[q.id].unread).length

  const tabs = [
    { id: 'list', label: 'Questions', meta: `${tally.done}/${tally.total}` },
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
            {tally.done}/{tally.total}
          </span>
          <span className="sr-only">Show questions</span>
        </button>

        <div className="ws-list-inner">
          <QuestionList
            course={course}
            groups={visibleGroups}
            progress={progress}
            activeId={activeId}
            tally={tally}
            onSelect={selectQuestion}
            onAskOwn={addOwnQuestion}
            onCollapse={() => setListCollapsed(true)}
          />
        </div>
      </aside>

      <main className="ws-pane ws-problem">
        <QuestionPanel
          question={active}
          state={activeState}
          position={{ current: index + 1, total: visible.length }}
          previous={visible[index - 1]}
          next={visible[index + 1]}
          onSelfMark={setSelfMark}
          onDraftChange={setDraft}
          onModeChange={setMode}
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
            onRate={rateMessage}
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
