import { useState } from 'react'
import { course } from '../data/course'
import './Entry.css'

/**
 * Nothing happens until the student agrees to being recorded, then picks what
 * to work on. Declining is a dead end by design — the study has no version
 * that collects data without consent.
 *
 * The consent wording here is a PLACEHOLDER. Replace it with the text your
 * ethics committee approves before this goes near a real student.
 */
export default function Entry({ onStart }) {
  const [step, setStep] = useState('consent')
  const [agreed, setAgreed] = useState(false)
  const [topic, setTopic] = useState('all')

  const total = course.groups.reduce((sum, group) => sum + group.questions.length, 0)

  if (step === 'declined') {
    return (
      <main className="en-page">
        <div className="en-card">
          <p className="eyebrow">Not started</p>
          <h1 className="en-title">Nothing has been recorded</h1>
          <p className="en-lede">
            The workspace only runs with consent, so there is nothing further to do here. You can
            close this tab.
          </p>
          <button type="button" className="en-btn" onClick={() => setStep('consent')}>
            Back to the consent form
          </button>
        </div>
      </main>
    )
  }

  if (step === 'topic') {
    return (
      <main className="en-page">
        <div className="en-card">
          <p className="eyebrow">Step 2 of 2</p>
          <h1 className="en-title">What do you want to work on?</h1>
          <p className="en-lede">Pick one topic, or take the whole set. You can change later.</p>

          <div className="en-topics" role="radiogroup" aria-label="Topic">
            <button
              type="button"
              className="en-topic"
              aria-checked={topic === 'all'}
              role="radio"
              onClick={() => setTopic('all')}
            >
              <span className="en-topic-name">Everything</span>
              <span className="en-topic-meta mono">{total} questions</span>
            </button>

            {course.groups.map((group) => (
              <button
                key={group.id}
                type="button"
                className="en-topic"
                aria-checked={topic === group.id}
                role="radio"
                onClick={() => setTopic(group.id)}
              >
                <span className="en-topic-name">{group.title}</span>
                <span className="en-topic-meta mono">{group.questions.length} questions</span>
              </button>
            ))}
          </div>

          <div className="en-actions">
            <button type="button" className="en-btn en-btn-primary" onClick={() => onStart(topic)}>
              Start working
            </button>
            <button type="button" className="en-btn" onClick={() => setStep('consent')}>
              Back
            </button>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="en-page">
      <div className="en-card">
        <p className="eyebrow">Step 1 of 2 · Consent</p>
        <h1 className="en-title">{course.title}</h1>
        <p className="en-lede">
          This workspace is part of a research study on how AI feedback helps students work through
          problems. Please read this before you start.
        </p>

        <div className="en-terms">
          <h2 className="en-terms-head">What gets recorded</h2>
          <ul className="en-list">
            <li>Everything you type to the tutor, and everything it replies.</li>
            <li>Your answers — typed, drawn or uploaded — and the marks on them.</li>
            <li>Which questions you open, how you mark them, and when.</li>
          </ul>

          <h2 className="en-terms-head">How it is used</h2>
          <ul className="en-list">
            <li>To build an anonymous dataset for research on AI feedback in teaching.</li>
            <li>Your teacher may read your conversations and label them for the study.</li>
            <li>You are not asked for your name, your email or your school.</li>
          </ul>

          <p className="en-warn">
            Do not type your name, anyone else&rsquo;s name, or any other personal detail into the
            workspace. You can stop at any time by closing the tab.
          </p>
        </div>

        <label className="en-agree">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(event) => setAgreed(event.target.checked)}
          />
          <span>
            I have read this, and I agree to my answers and conversations being recorded for this
            research.
          </span>
        </label>

        <div className="en-actions">
          <button
            type="button"
            className="en-btn en-btn-primary"
            disabled={!agreed}
            onClick={() => setStep('topic')}
          >
            Agree and continue
          </button>
          <button type="button" className="en-btn" onClick={() => setStep('declined')}>
            I do not agree
          </button>
        </div>
      </div>
    </main>
  )
}
