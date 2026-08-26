import { useState } from 'react'
import { Link, Navigate, Outlet, useLocation } from 'react-router-dom'
import { NICKNAME_MAX } from '../../../shared/session'
import { isStaff } from '../../../shared/roles'
import { homeFor, useAuth } from '../../lib/auth'
import { useT } from '../../lib/i18n'
import TopBar from '../../components/TopBar'
import '../../components/Entry.css'
import '../console.css'

/**
 * Everything before a session starts, in the order the questions actually have
 * to be asked:
 *
 *   1  who are you    anonymously, or signed in with a password
 *   2  a nickname     anonymous only, and optional — see ./nickname below
 *   3  the work       pick from the list, or the activity a class code named
 *
 * Who gets asked, and how often:
 *
 *   nobody yet               nothing, until they say which they are
 *   anonymous student        the nickname step, every visit
 *   student with an account  nothing further: they go straight to the work
 *   teacher, manager, admin  nothing: they are sent to their console instead
 *
 * Because every branch is derived from who is signed in rather than stored as a
 * step, signing out from the bar above puts the questions back in order: whoever
 * is left behind is an unidentified visitor again.
 */
export default function StudentLayout() {
  const t = useT()
  const { pathname } = useLocation()
  const { user, ready, problem, refresh } = useAuth()

  const [working, setWorking] = useState(null) // 'anon' once they choose
  const [nickname, setNickname] = useState('')
  const [named, setNamed] = useState(false) // the nickname step is behind them

  /**
   * Only the list flow asks who.
   *
   * Arriving with a class code is already a declaration — nobody types the code
   * their teacher read out unless they are in that class — and anyone who meant
   * to be signed in instead has the bar at the top of every one of these screens.
   */
  const needsWho = ready && !user && pathname === '/'

  /**
   * Which steps this person's flow has, so the numbering is theirs rather than a
   * constant that would be wrong for the other two cases above.
   */
  const steps = [...(needsWho ? ['who', 'nickname'] : []), 'work']
  const stepOf = (name) => steps.indexOf(name) + 1

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
        <TopBar join={false} console={false} />
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

  /* 1 — who. Skipped by anyone already signed in, and by the class-code flow. */
  if (needsWho && working !== 'anon') {
    return (
      <main className="en-page">
        <TopBar />
        <div className="en-card">
          <p className="eyebrow">
            {t('entry.step', { current: stepOf('who'), total: steps.length })}
          </p>
          <h1 className="en-title">{t('entry.who.title')}</h1>
          <p className="en-lede">{t('entry.who.lede')}</p>

          <div className="en-topics">
            <button type="button" className="en-topic" onClick={() => setWorking('anon')}>
              <span className="en-topic-name">{t('entry.who.anon')}</span>
              <span className="en-topic-meta">{t('entry.who.anonMeta')}</span>
            </button>

            {/* The way in for staff as well, and now nothing stands in front of
                it: this is the first screen anybody sees. */}
            <Link className="en-topic" to="/signin" state={{ from: '/' }}>
              <span className="en-topic-name">{t('entry.who.signIn')}</span>
              <span className="en-topic-meta">{t('entry.who.signInMeta')}</span>
            </Link>
          </div>
        </div>
      </main>
    )
  }

  /**
   * 2 — the nickname, asked once they have chosen to work anonymously.
   *
   * "Anonymously" otherwise leaves a teacher with nothing to call the work but a
   * six-character session code, which tells them nothing about whose it is. A
   * nickname answers that: made up, **optional**, and never checked against
   * anything. Requiring one would push a child into typing their real name.
   *
   * Held in this component until a session starts, so nothing about them
   * reaches the server until they actually begin an activity.
   */
  if (needsWho && !named) {
    return (
      <main className="en-page">
        <TopBar />
        <div className="en-card">
          <p className="eyebrow">
            {t('entry.step', { current: stepOf('nickname'), total: steps.length })}
          </p>
          <h1 className="en-title">{t('entry.nickname.title')}</h1>
          <p className="en-lede">{t('entry.nickname.lede')}</p>

          <form
            className="cs-form"
            onSubmit={(event) => {
              event.preventDefault()
              setNamed(true)
            }}
          >
            <div className="cs-field">
              <label className="cs-label" htmlFor="nickname">
                {t('entry.nickname.label')}
              </label>
              <input
                id="nickname"
                className="cs-input"
                autoFocus
                autoComplete="off"
                maxLength={NICKNAME_MAX}
                placeholder={t('entry.nickname.placeholder')}
                value={nickname}
                onChange={(event) => setNickname(event.target.value)}
              />
              <p className="cs-hint">{t('entry.nickname.hint')}</p>
            </div>

            <div className="en-actions">
              {/* Enabled with the field empty: staying unnamed is a choice, and
                  the session code labels the work as it always did. */}
              <button type="submit" className="en-btn en-btn-primary">
                {t('entry.nickname.go')}
              </button>
              <button
                type="button"
                className="en-btn"
                onClick={() => {
                  setWorking(null)
                  setNickname('')
                }}
              >
                {t('common.back')}
              </button>
            </div>
          </form>
        </div>
      </main>
    )
  }

  /* 3 — the work. */
  return (
    <main className="en-page">
      <TopBar />
      <Outlet
        context={{
          /** Anonymous only: a signed-in session is labelled by its account. */
          nickname: user ? '' : nickname.trim(),
          step: stepOf('work'),
          totalSteps: steps.length,
        }}
      />
    </main>
  )
}
