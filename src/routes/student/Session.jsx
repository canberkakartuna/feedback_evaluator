import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../../lib/api'
import { DEFAULT_MODE } from '../../lib/answer'
import { readAsDataUrl } from '../../lib/attachments'
import { useMediaQuery } from '../../lib/useMediaQuery'
import { ownTutor } from '../../../shared/tutor-scripts'
import QuestionList from '../../components/QuestionList'
import QuestionPanel from '../../components/QuestionPanel'
import TutorPanel from '../../components/TutorPanel'
import '../../components/Workspace.css'
import '../console.css'

const DOCKED_TUTOR = '(min-width: 1180px)'
const DRAFT_DEBOUNCE = 700

/**
 * The workspace, running on the API.
 *
 * This used to keep everything in local state over a bundled copy of the
 * questions. It no longer does, and the difference is the point of the whole
 * rewrite: **the server is the source of truth for anything the study will
 * later be read from.** Marking, hint escalation and every tutor reply happen
 * server-side, because a mark scheme the browser holds is a mark scheme the
 * student can read, and a hint counter the browser holds is one they can reset.
 *
 * Local state is a mirror of what came back, not a second opinion. The one
 * exception is the draft textarea, which is edited locally and pushed on a
 * debounce — a request per keystroke would be unusable, and a lost final
 * keystroke is caught because switching question flushes first.
 */

/** Server answer + message thread → the shape the three panels already expect. */
function toState(question, answer, messages) {
  const opening = {
    id: `${question.id}-opening`,
    from: 'tutor',
    kind: 'opening',
    text: question.opening || ownTutor.opening,
  }

  return {
    mode: answer?.mode ?? DEFAULT_MODE,
    status: answer?.status ?? 'new',
    selfMark: answer?.selfMark ?? null,
    draft: answer?.draft ?? '',
    attachments: answer?.attachments ?? [],
    strokes: answer?.strokes ?? [],
    feedback: answer?.feedback ?? null,
    feedbackFor: answer?.feedbackFor ?? null,
    hintsUsed: answer?.hintsUsed ?? 0,
    unread: false,
    // Ratings live on the message server-side; the panel wants them keyed.
    ratings: Object.fromEntries(
      messages.filter((message) => message.rating).map((message) => [message.id, message.rating]),
    ),
    messages: [opening, ...messages],
  }
}

export default function Session() {
  const { sessionId } = useParams()
  const navigate = useNavigate()

  const [loaded, setLoaded] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [progress, setProgress] = useState({})
  const [activeId, setActiveId] = useState(null)
  const [mobileView, setMobileView] = useState('problem')
  const [tutorOpen, setTutorOpen] = useState(false)
  const [tutorCollapsed, setTutorCollapsed] = useState(false)
  const [listCollapsed, setListCollapsed] = useState(false)
  const [pendingIds, setPendingIds] = useState([])
  const [problem, setProblem] = useState(null)

  const tutorIsDocked = useMediaQuery(DOCKED_TUTOR)

  /* ── loading ─────────────────────────────────────────────── */

  useEffect(() => {
    let alive = true

    api
      .resumeSession(sessionId)
      .then((data) => {
        if (!alive) return

        const questions = [
          ...(data.activity?.questions ?? []),
          ...data.ownQuestions.map((question) => ({ ...question, isOwnQuestion: true })),
        ]

        const byQuestion = new Map()
        for (const message of data.messages) {
          if (!byQuestion.has(message.questionId)) byQuestion.set(message.questionId, [])
          byQuestion.get(message.questionId).push(message)
        }

        const map = {}
        for (const question of questions) {
          map[question.id] = toState(
            question,
            data.answers.find((answer) => answer.questionId === question.id),
            byQuestion.get(question.id) ?? [],
          )
        }

        setLoaded({ session: data.session, activity: data.activity, questions })
        setProgress(map)
        setActiveId((current) => current ?? questions[0]?.id ?? null)
      })
      .catch((failure) => alive && setLoadError(failure))

    return () => {
      alive = false
    }
  }, [sessionId])

  /* ── local mirroring ─────────────────────────────────────── */

  const patch = useCallback((id, fields) => {
    setProgress((prev) => (prev[id] ? { ...prev, [id]: { ...prev[id], ...fields } } : prev))
  }, [])

  /** Folds a server answer document back over the local mirror. */
  const applyAnswer = useCallback(
    (id, answer) =>
      patch(id, {
        mode: answer.mode ?? DEFAULT_MODE,
        status: answer.status ?? 'new',
        selfMark: answer.selfMark ?? null,
        draft: answer.draft ?? '',
        attachments: answer.attachments ?? [],
        strokes: answer.strokes ?? [],
        feedback: answer.feedback ?? null,
        feedbackFor: answer.feedbackFor ?? null,
        hintsUsed: answer.hintsUsed ?? 0,
      }),
    [patch],
  )

  const fail = useCallback((error) => setProblem(error.message), [])

  /* ── draft: local, pushed on a debounce ──────────────────── */

  const timer = useRef(null)
  const outstanding = useRef(null)

  const flushDraft = useCallback(async () => {
    if (!outstanding.current) return
    const { questionId, draft } = outstanding.current
    outstanding.current = null
    clearTimeout(timer.current)

    try {
      await api.saveAnswer(sessionId, questionId, { draft })
    } catch (error) {
      fail(error)
    }
  }, [fail, sessionId])

  const setDraft = useCallback(
    (text) => {
      patch(activeId, { draft: text })
      outstanding.current = { questionId: activeId, draft: text }

      clearTimeout(timer.current)
      timer.current = setTimeout(flushDraft, DRAFT_DEBOUNCE)
    },
    [activeId, flushDraft, patch],
  )

  // A draft still in the debounce window when the tab goes away would be lost.
  useEffect(() => {
    const flush = () => {
      if (outstanding.current) {
        const { questionId, draft } = outstanding.current
        navigator.sendBeacon?.(
          `/api/sessions/${sessionId}/answers/${questionId}`,
          new Blob([JSON.stringify({ draft })], { type: 'application/json' }),
        )
      }
    }
    window.addEventListener('pagehide', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      clearTimeout(timer.current)
    }
  }, [sessionId])

  /* ── derived ─────────────────────────────────────────────── */

  // Memoised rather than `loaded?.questions ?? []`, which would hand every
  // downstream memo a brand new array on each render and quietly disable them.
  const questions = useMemo(() => loaded?.questions ?? [], [loaded])

  const groups = useMemo(() => {
    if (!loaded) return []

    const authored = questions.filter((question) => !question.isOwnQuestion)
    const own = questions.filter((question) => question.isOwnQuestion)

    return [
      { id: 'activity', title: loaded.activity?.title ?? 'Questions', questions: authored },
      ...(own.length ? [{ id: 'own', title: 'Your own questions', questions: own }] : []),
    ]
  }, [loaded, questions])

  const index = questions.findIndex((question) => question.id === activeId)
  const active = questions[index] ?? questions[0] ?? null
  const activeState = active ? progress[active.id] : null

  const tally = useMemo(() => {
    let done = 0
    for (const question of questions) {
      const state = progress[question.id]
      if (!state) continue
      if (state.selfMark === 'done' || (!state.selfMark && state.status === 'mastered')) done += 1
    }
    return { done, total: questions.length }
  }, [progress, questions])

  /* ── actions ─────────────────────────────────────────────── */

  const selectQuestion = useCallback(
    (id) => {
      flushDraft()
      setActiveId(id)
      setMobileView('problem')
    },
    [flushDraft],
  )

  const step = useCallback(
    (delta) => {
      const next = questions[index + delta]
      if (next) selectQuestion(next.id)
    },
    [index, questions, selectQuestion],
  )

  const setSelfMark = useCallback(
    async (mark) => {
      patch(activeId, { selfMark: mark })
      try {
        const { answer } = await api.saveAnswer(sessionId, activeId, { selfMark: mark })
        applyAnswer(activeId, answer)
      } catch (error) {
        fail(error)
      }
    },
    [activeId, applyAnswer, fail, patch, sessionId],
  )

  const setMode = useCallback(
    async (mode) => {
      if (!activeState || mode === activeState.mode) return
      try {
        // The server is what clears the old answer when the mode changes, so
        // there is no local version of that rule to drift from it.
        const { answer } = await api.saveAnswer(sessionId, activeId, { mode })
        applyAnswer(activeId, answer)
      } catch (error) {
        fail(error)
      }
    },
    [activeId, activeState, applyAnswer, fail, sessionId],
  )

  const attach = useCallback(
    async (files) => {
      for (const file of files) {
        try {
          const dataUrl = await readAsDataUrl(file)
          const { answer } = await api.upload(sessionId, activeId, {
            name: file.name,
            dataUrl,
            source: 'file',
          })
          applyAnswer(activeId, answer)
        } catch (error) {
          fail(error)
        }
      }
    },
    [activeId, applyAnswer, fail, sessionId],
  )

  const saveBoard = useCallback(
    async (strokes, image) => {
      try {
        // Strokes are the editable record; the PNG is what a marker looks at.
        const { answer } = await api.saveAnswer(sessionId, activeId, { strokes })
        applyAnswer(activeId, answer)

        if (image) {
          const uploaded = await api.upload(sessionId, activeId, {
            name: image.name,
            dataUrl: image.url,
            source: 'whiteboard',
          })
          applyAnswer(activeId, uploaded.answer)
        }
      } catch (error) {
        fail(error)
      }
    },
    [activeId, applyAnswer, fail, sessionId],
  )

  const detach = useCallback(
    async (fileId) => {
      try {
        const { answer } = await api.removeUpload(sessionId, activeId, fileId)
        applyAnswer(activeId, answer)
      } catch (error) {
        fail(error)
      }
    },
    [activeId, applyAnswer, fail, sessionId],
  )

  const append = useCallback((id, ...messages) => {
    setProgress((prev) =>
      prev[id] ? { ...prev, [id]: { ...prev[id], messages: [...prev[id].messages, ...messages] } } : prev,
    )
  }, [])

  const checkAnswer = useCallback(async () => {
    await flushDraft()

    try {
      const { answer, feedback } = await api.checkAnswer(sessionId, activeId)
      applyAnswer(activeId, answer)

      append(activeId, {
        id: `mark-${Date.now()}`,
        from: 'tutor',
        kind: 'note',
        text: feedback.markable
          ? `Marked ${active.code} — ${feedback.earned} of ${feedback.total}. ${
              feedback.verdict === 'mastered' ? 'Full marks.' : feedback.nextStep
            }`
          : `${active.code} is with your teacher to mark by hand. I cannot score a drawing or a photo.`,
      })
    } catch (error) {
      fail(error)
    }
  }, [active, activeId, append, applyAnswer, fail, flushDraft, sessionId])

  /** The tutor answers server-side; this only shows that it is thinking. */
  const converse = useCallback(
    async (request) => {
      const id = activeId
      setPendingIds((prev) => [...prev, id])

      try {
        const { student, tutor, hintsUsed } = await request()
        append(id, student, tutor)
        patch(id, { hintsUsed: hintsUsed ?? progress[id]?.hintsUsed ?? 0, unread: true })
      } catch (error) {
        fail(error)
      } finally {
        setPendingIds((prev) => prev.filter((pending) => pending !== id))
      }
    },
    [activeId, append, fail, patch, progress],
  )

  const send = useCallback(
    (text) => {
      if (!text.trim()) return
      return converse(() => api.sendMessage(sessionId, activeId, text.trim()))
    },
    [activeId, converse, sessionId],
  )

  const quickAction = useCallback(
    (kind) => converse(() => api.runAction(sessionId, activeId, kind)),
    [activeId, converse, sessionId],
  )

  const rateMessage = useCallback(
    async (messageId, value) => {
      patch(activeId, { ratings: { ...progress[activeId].ratings, [messageId]: value } })
      try {
        await api.rateMessage(sessionId, messageId, value)
      } catch (error) {
        fail(error)
      }
    },
    [activeId, fail, patch, progress, sessionId],
  )

  const addOwnQuestion = useCallback(
    async (prompt) => {
      if (!prompt.trim()) return
      try {
        const { question } = await api.addOwnQuestion(sessionId, prompt)
        const entry = { ...question, isOwnQuestion: true, markable: false }

        setLoaded((prev) => ({ ...prev, questions: [...prev.questions, entry] }))
        setProgress((prev) => ({ ...prev, [entry.id]: toState(entry, null, []) }))
        setActiveId(entry.id)
        setMobileView('problem')
      } catch (error) {
        fail(error)
      }
    },
    [fail, sessionId],
  )

  /** The withdrawal half of consent, offered where the student actually is. */
  const withdraw = useCallback(async () => {
    if (!window.confirm('Delete everything from this session? This cannot be undone.')) return
    try {
      await api.deleteSession(sessionId)
      navigate('/', { replace: true })
    } catch (error) {
      fail(error)
    }
  }, [fail, navigate, sessionId])

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

  const tutorVisible = tutorIsDocked ? !tutorCollapsed : mobileView === 'tutor' || tutorOpen

  useEffect(() => {
    if (activeId && tutorVisible && progress[activeId]?.unread) patch(activeId, { unread: false })
  }, [activeId, patch, progress, tutorVisible])

  useEffect(() => {
    if (!tutorOpen) return
    const onKey = (event) => event.key === 'Escape' && setTutorOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tutorOpen])

  if (loadError) {
    return (
      <main className="en-page">
        <div className="en-card">
          <p className="eyebrow">Cannot open this session</p>
          <h1 className="en-title">{loadError.message}</h1>
          <button type="button" className="en-btn en-btn-primary" onClick={() => navigate('/')}>
            Start again
          </button>
        </div>
      </main>
    )
  }

  if (!loaded || !active || !activeState) {
    return (
      <main className="splash">
        <p className="eyebrow">Loading your work</p>
      </main>
    )
  }

  const unreadCount = questions.filter((question) => progress[question.id]?.unread).length

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
      {problem ? (
        <div className="ws-problem-banner" role="alert">
          <span>{problem}</span>
          <button type="button" onClick={() => setProblem(null)} aria-label="Dismiss">
            ×
          </button>
        </div>
      ) : null}

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
            course={{
              title: loaded.activity?.title ?? 'Your questions',
              subtitle: loaded.session.code,
            }}
            groups={groups}
            progress={progress}
            activeId={active.id}
            tally={tally}
            onSelect={selectQuestion}
            onAskOwn={addOwnQuestion}
            onCollapse={() => setListCollapsed(true)}
            onWithdraw={withdraw}
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
            pending={pendingIds.includes(active.id)}
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
