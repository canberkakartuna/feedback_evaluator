import { useMemo } from 'react'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import { splitMath } from '../lib/latex'

/**
 * A teacher's text, with the LaTeX in it rendered.
 *
 * Everywhere a prompt or an answer is shown — the student's question sheet,
 * the teacher's question list, the transcript, the form's preview — goes
 * through here, so `$\frac{3}{4}$` is the same fraction on every one of them.
 * Plain text stays plain React text nodes; only KaTeX's own output is injected
 * as HTML, and KaTeX escapes what it is given, so a prompt cannot smuggle
 * markup in.
 *
 * `throwOnError: false` because this renders other people's typing: a typo in
 * a formula shows the formula's source in red rather than taking the whole
 * question down with it.
 */
export default function MathText({ text }) {
  const segments = useMemo(() => splitMath(text ?? ''), [text])

  return segments.map((segment, index) =>
    segment.kind === 'math' ? (
      <span
        key={index}
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{
          __html: katex.renderToString(segment.value, {
            throwOnError: false,
            displayMode: segment.display,
          }),
        }}
      />
    ) : (
      <span key={index}>{segment.value}</span>
    ),
  )
}
