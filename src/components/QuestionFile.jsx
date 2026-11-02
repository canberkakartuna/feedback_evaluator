import { useT } from '../lib/i18n'

/**
 * A file a teacher uploaded with a question — the question itself, or their
 * answer — shown the way its type needs.
 *
 * Pictures are an `<img>`, as they always were. A PDF is not a picture, and it
 * used to be put in an `<img>` anyway, which a browser draws as nothing at all:
 * the teacher uploaded a question and the student saw an empty space. A PDF is
 * embedded instead, with a link to open it full size, because an embedded
 * viewer on a phone is often too small to read — and some mobile browsers show
 * no embed at all, which leaves the link as the way in.
 */
const isPdf = (file) => file?.type === 'application/pdf'

export default function QuestionFile({ file, alt, className, frameClassName }) {
  const t = useT()
  const url = file.preview ?? file.url

  if (!isPdf(file)) return <img className={className} src={url} alt={alt} />

  return (
    <span className="qf-pdf">
      <iframe className={frameClassName} src={url} title={file.name || alt} />
      <a className="qf-pdf-link mono" href={url} target="_blank" rel="noreferrer">
        {t('qp.openPdf', { name: file.name || 'PDF' })}
      </a>
    </span>
  )
}
