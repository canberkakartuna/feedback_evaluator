import { useState } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { NICKNAME_MAX } from '../../../shared/session'
import { isStaff } from '../../../shared/roles'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useT } from '../../lib/i18n'
import ConsentCard from '../../components/ConsentCard'
import TopBar from '../../components/TopBar'
import '../../components/Entry.css'
import '../console.css'

/**
 * Everything before a session starts, in the order the questions actually have
 * to be asked:
 *
 *   1  who are you    anonymously, or signed in with a password
 *   2  a nickname     anonymous only, and optional — see ./nickname below
 *   3  consent        the research notice — only for the people from (1)
 *   4  the work       pick from the list, or the activity a class code named
 *
 * **The order is the point.** The notice used to be first, which meant everyone
 * who opened the site met a research consent form before they could say who they
 * were — including a teacher who had not signed in yet, whose route to the
 * sign-in screen ran straight through it. Asking who first means the notice is
 * only ever shown to somebody who has just said they are a student: they chose to
 * work anonymously, or they are signed in with a student account.
 *
 * Who gets asked, and how often:
 *
 *   nobody yet               nothing, until they say which they are
 *   anonymous student        every visit — nothing to remember it against
 *   student with an account  once, ever; see `agreed` below
 *   teacher, manager, admin  never; what they start is recorded as a preview
 *
 * **Asked once.** Every screen in (3) is a child of one layout element (see
 * App.jsx), so agreeing and then walking between them does not ask again — the
 * answer is held here, above all of them. For an account it outlives the visit:
 * agreeing calls `POST /api/auth/consent`, and `user.consented` is what later
 * visits read. Bumping `CONSENT_VERSION` on the server asks everybody again,
 * which is the whole reason the version exists.
 *
 * Because every branch is derived from who is signed in rather than stored as a
 * step, signing out from the bar above puts the questions back in order: whoever
 * is left behind is an unidentified visitor again.
 *
 * `/work/:sessionId` is deliberately **not** inside this layout. Its consent was
 * recorded when the session was created and lives on the session itself, so
 * gating it again would ask a student to re-consent every time they reloaded the
 * page they were working on.
 */
export default function StudentLayout() {
  const t = useT()
  const { pathname } = useLocation()
  const { user, ready, problem, refresh, setUser } = useAuth()

  const [working, setWorking] = useState(null) // 'anon' once they choose
  const [nickname, setNickname] = useState('')
  const [named, setNamed] = useState(false) // the nickname step is behind them
  const [consented, setConsented] = useState(false)
  const [declined, setDeclined] = useState(false)

  const staff = ready && isStaff(user?.role)

  /**
   * Only the list flow asks who.
   *
   * Arriving with a class code is already a declaration — nobody types the code
   * their teacher read out unless they are in that class — and anyone who meant
   * to be signed in instead has the bar at the top of every one of these screens.
   */
  const needsWho = ready && !user && pathname === '/'

  /**
   * Agreed to, either just now or on a previous visit. `user.consented` is the
   * server's answer, version comparison included — see publicUser in
   * services/users.js — so this screen never has to know what the current
   * wording is called.
   */
  const agreed = consented || Boolean(user?.consented)

  /**
   * Which steps this person's flow has, so the numbering is theirs rather than a
   * constant that would be wrong for three of the four cases above.
   */
  const steps = [
    ...(needsWho ? ['who', 'nickname'] : []),
    ...(staff ? [] : ['consent']),
    'work',
  ]
  const stepOf = (name) => steps.indexOf(name) + 1

  const agree = async () => {
    setConsented(true)
    if (!user) return

    try {
      // So the next visit does not ask again. A failure here is not worth
      // stopping them for: they have agreed, this session will record it, and
      // the worst case is being asked once more next time.
      const { user: updated } = await api.recordConsent()
      setUser(updated)
    } catch {
      /* asked again next time */
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
   * guess here shows a teacher a form written for a research subject.
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

  if (declined) {
    return (
      <main className="en-page">
        <TopBar join />
        <div className="en-card">
          <p className="eyebrow">{t('entry.declined.eyebrow')}</p>
          <h1 className="en-title">{t('entry.declined.title')}</h1>
          <p className="en-lede">{t('entry.declined.lede')}</p>
          <button
            type="button"
            className="en-btn"
            onClick={() => {
              setDeclined(false)
              setWorking(null)
              setNamed(false)
            }}
          >
            {t('entry.declined.back')}
          </button>
        </div>
      </main>
    )
  }

  /* 1 — who. Skipped by anyone already signed in, and by the class-code flow. */
  if (needsWho && working !== 'anon') {
    return (
      <main className="en-page">
        <TopBar join />
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
   * nickname answers that, and every property of it follows from the study being
   * anonymous: made up, **optional**, and never checked against anything.
   * Requiring one would push a child into typing their real name — the single
   * thing the notice on the next step asks them not to do.
   *
   * It is asked before the notice and held in this component until a session
   * starts, so nothing about them reaches the server ahead of their agreement.
   */
  if (needsWho && !named) {
    return (
      <main className="en-page">
        <TopBar join />
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

  /* 3 — consent, for whoever has just said they are a student. */
  if (!staff && !agreed) {
    return (
      <main className="en-page">
        {/* The class-code button is offered here too. Following it does not skip
            anything — /join is behind this same gate — and a student who was
            given a code should not have to read a list first to use it. */}
        <TopBar join />
        <ConsentCard
          eyebrow={`${t('entry.step', {
            current: stepOf('consent'),
            total: steps.length,
          })} · ${t('entry.consent.eyebrow')}`}
          onAgree={agree}
          onDecline={() => setDeclined(true)}
        />
      </main>
    )
  }

  /* 4 — the work. */
  return (
    <main className="en-page">
      <TopBar join />
      {/**
       * `consent` is the value the child sends to `POST /api/sessions`: true for
       * somebody who has agreed, false for staff who were never shown the notice.
       * It is passed rather than recomputed so that "did this person consent?" is
       * answered in one place — this one.
       */}
      <Outlet
        context={{
          staff,
          consent: !staff,
          /** Anonymous only: a signed-in session is labelled by its account. */
          nickname: user ? '' : nickname.trim(),
          step: stepOf('work'),
          totalSteps: steps.length,
        }}
      />
    </main>
  )
}
