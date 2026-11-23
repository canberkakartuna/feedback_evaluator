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
 *
 * `inline` sets even display math (`$$…$$`) in the line, for a one- or
 * two-line preview such as the student's question list.
 */
export default function MathText({ text, inline = false }) {
  /**
   * Rendered once per text, not once per render. React re-sets innerHTML
   * whenever the `dangerouslySetInnerHTML` object is a new one, so building it
   * inline replaced every formula's DOM on each re-render of the parent — a
   * keystroke in the tutor's box redrew the whole thread, and a click whose
   * mousedown landed on a formula that got replaced was dropped.
   */
  const segments = useMemo(
    () =>
      splitMath(text ?? '').map((segment) =>
        segment.kind === 'math'
          ? {
              ...segment,
              html: {
                __html: katex.renderToString(segment.value, {
                  throwOnError: false,
                  displayMode: segment.display && !inline,
                }),
              },
            }
          : segment,
      ),
    [text, inline],
  )

  return segments.map((segment, index) =>
    segment.kind === 'math' ? (
      // eslint-disable-next-line react/no-danger
      <span key={index} dangerouslySetInnerHTML={segment.html} />
    ) : (
      <span key={index}>{segment.value}</span>
    ),
  )
}
