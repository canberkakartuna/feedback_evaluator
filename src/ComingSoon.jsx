import './ComingSoon.css'

export default function ComingSoon({
  title = 'Feedback Evaluator',
  tagline = 'Turn raw customer feedback into decisions you can act on.',
  launch = 'Launching soon',
}) {
  return (
    <main className="cs-page">
      <div className="cs-card">
        <p className="cs-badge">{launch}</p>

        <h1 className="cs-title">{title}</h1>
        <p className="cs-tagline">{tagline}</p>

        <div className="cs-rule" aria-hidden="true" />

        <p className="cs-note">
          We&rsquo;re putting the finishing touches on it. Check back shortly.
        </p>
      </div>

      <footer className="cs-footer">
        &copy; {new Date().getFullYear()} {title}
      </footer>
    </main>
  )
}
