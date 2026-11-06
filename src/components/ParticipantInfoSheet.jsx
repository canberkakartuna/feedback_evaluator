import { useI18n } from '../lib/i18n'
import { linkify, participantInfoFor } from '../lib/participantInfo'
import './ParticipantInfoSheet.css'

/** One paragraph of the sheet, with its emails and URLs made clickable. */
function Linked({ text }) {
  return linkify(text).map((part, index) =>
    part.href ? (
      <a key={index} href={part.href} target="_blank" rel="noreferrer">
        {part.text}
      </a>
    ) : (
      part.text
    ),
  )
}

/**
 * The full participant information sheet in the interface language — see
 * lib/participantInfo.js for the text and why it lives there.
 */
export default function ParticipantInfoSheet() {
  const { lang } = useI18n()
  const sheet = participantInfoFor(lang)

  return (
    <article className="pis" lang={lang}>
      <h2 className="pis-title">{sheet.title}</h2>
      <p className="pis-committee">{sheet.committee}</p>

      <dl className="pis-details">
        {sheet.details.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>
              <Linked text={value} />
            </dd>
          </div>
        ))}
      </dl>

      <p>{sheet.intro}</p>

      {sheet.sections.map((section) => (
        <section key={section.heading}>
          <h3 className="pis-heading">{section.heading}</h3>
          {section.paragraphs.map((paragraph, index) => (
            <p key={index}>
              <Linked text={paragraph} />
            </p>
          ))}
        </section>
      ))}

      <p className="pis-closing">{sheet.closing}</p>
    </article>
  )
}
