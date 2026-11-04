import { useState } from 'react'
import { Navigate, Outlet } from 'react-router-dom'
import { isStaff } from '../../../shared/roles'
import { homeFor, useAuth } from '../../lib/auth'
import { useT } from '../../lib/i18n'
import Navbar from '../../components/Navbar'
import SignInDoors from '../../components/SignInDoors'
import '../../components/Entry.css'
import '../console.css'

/**
 * Everything before a session starts, in the order the questions actually have
 * to be asked:
 *
 *   1  who are you    a username (their 8-digit student number) off the class
 *                     list; teachers use the other door, /signin
 *   —  the notice     once, ever, the first time they sign in — that is the
 *                     ConsentGate in App.jsx, not a step here
 *   2  the work       pick from the list, or the activity a class code named
 *
 * Who gets asked, and how often:
 *
 *   nobody yet               their student number, on every path — the list
 *                            and a class code alike
 *   student, signed in       nothing further: they go straight to the work
 *   teacher, manager, admin  nothing: they are sent to their console instead
 *
 * There is no anonymous way in any more. The server refuses a session without
 * a signed-in student (`studentSignInRequired` in server/config.js), because
 * the class list is what keeps the tutor to the class — so a screen offering
 * one would end in a refusal.
 *
 * Because every branch is derived from who is signed in rather than stored as a
 * step, signing out from the bar above puts the questions back in order.
 */
export default function StudentLayout() {
  const t = useT()
  const { user, ready, problem, refresh, signInWithNumber } = useAuth()

  const [studentNumber, setStudentNumber] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const needsWho = ready && !user

  /**
   * Which steps this person's flow has, so the numbering is theirs rather than a
   * constant that would be wrong for someone already signed in.
   */
  const steps = [...(needsWho ? ['who'] : []), 'work']

  /** A username is exactly eight digits (3 Nov 2026 doc). */
  const usernameReady = /^\d{8}$/.test(studentNumber)
  const stepOf = (name) => steps.indexOf(name) + 1

  const signIn = async (event) => {
    event.preventDefault()
    if (!usernameReady) return

    setBusy(true)
    setError(null)
    try {
      await signInWithNumber(studentNumber)
      // Nothing to navigate to: `user` is set, so this same route now renders
      // the notice (first time only) and then the work.
    } catch (failure) {
      // A 401 is the one answer worth putting in their language: the number is
      // not on a list. Anything else is shown as the server said it.
      setError(failure.status === 401 ? t('entry.who.notListed') : failure.message)
    } finally {
      setBusy(false)
    }
  }

  // Nothing renders before `me` settles. Every branch below reads who is asking,
  // and guessing for one frame means showing the wrong person the wrong screen.
  if (!ready) {
    return (
      <main className="splash">
        <p className="eyebrow">{t('app.loading')}</p>
      </main>
    )
  }

  /**
   * A token that could not be checked. Not the same as nobody — see the note in
   * lib/auth.jsx — and the reason it gets a screen of its own is that the wrong
   * guess here shows a signed-in teacher the student entry screen instead.
   */
  if (problem) {
    return (
      <main className="en-page">
        <Navbar join={false} console={false} />
        <div className="en-card">
          <p className="eyebrow">{t('entry.unknown.eyebrow')}</p>
          <h1 className="en-title">{t('entry.unknown.title')}</h1>
          <p className="en-lede">{t('entry.unknown.lede')}</p>
          <p className="cs-note" data-tone="bad">
            {problem.message}
          </p>
          <button type="button" className="en-btn en-btn-primary" onClick={refresh}>
            {t('entry.unknown.retry')}
          </button>
        </div>
      </main>
    )
  }

  /**
   * Staff do not come in here at all.
   *
   * They used to: the same list, with a line explaining that whatever they
   * started was a preview rather than a student's work. That door is closed —
   * the server refuses a session to a staff account (see routes/sessions.js),
   * so leaving the screens up would be offering a walk through steps that ends
   * in a refusal.
   *
   * Sent to their own console rather than to sign-in, which they would read as
   * "my password stopped working" — the same choice Guard makes in App.jsx for
   * the mirror-image case. It is after `problem` on purpose: a token that could
   * not be checked means nobody knows what this person is yet, and redirecting
   * on a guess is how a signed-in teacher ends up somewhere unexplained.
   *
   * Every role in `STAFF_ROLES` has a console in `homeFor`, so this always goes
   * somewhere other than `/`. A staff role added without one would bounce here
   * for ever — give it a console in the same commit.
   */
  if (isStaff(user?.role)) return <Navigate to={homeFor(user)} replace />

  /* 1 — who. Skipped by anyone already signed in. */
  if (needsWho) {
    return (
      <main className="en-page">
        <Navbar />
        <div className="en-card">
          <SignInDoors current="student" />
          <p className="eyebrow">
            {t('entry.step', { current: stepOf('who'), total: steps.length })}
          </p>
          <h1 className="en-title">{t('entry.who.title')}</h1>
          <p className="en-lede">{t('entry.who.lede')}</p>

          <form className="cs-form" onSubmit={signIn}>
            <div className="cs-field">
              <label className="cs-label" htmlFor="student-number">
                {t('entry.who.numberLabel')}
              </label>
              <input
                id="student-number"
                className="cs-input mono"
                autoFocus
                autoComplete="username"
                inputMode="numeric"
                pattern="[0-9]{8}"
                spellCheck="false"
                maxLength={8}
                placeholder={t('entry.who.numberPlaceholder')}
                value={studentNumber}
                // Digits only, so anything else cannot be typed in the first place.
                onChange={(event) => setStudentNumber(event.target.value.replace(/\D/g, '').slice(0, 8))}
              />
              <p className="cs-hint">{t('entry.who.numberHint')}</p>
            </div>

            {error ? (
              <p className="cs-note" data-tone="bad" role="alert">
                {error}
              </p>
            ) : null}

            <div className="en-actions">
              <button
                type="submit"
                className="en-btn en-btn-primary"
                disabled={busy || !usernameReady}
              >
                {busy ? t('entry.who.busy') : t('entry.who.go')}
              </button>
            </div>
          </form>
        </div>
      </main>
    )
  }

  /* 2 — the work. */
  return (
    <main className="en-page">
      <Navbar />
      <Outlet
        context={{
          step: stepOf('work'),
          totalSteps: steps.length,
        }}
      />
    </main>
  )
}
