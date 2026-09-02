import { useState } from 'react'
import { LIMITS } from '../../../shared/activity'
import MathText from '../../components/MathText'
import { ACCEPT, formatBytes, partitionFiles, readAsDataUrl } from '../../lib/attachments'
import { hasMath } from '../../lib/latex'
import { useT } from '../../lib/i18n'

/**
 * Writing or editing one question. Two blocks, question and answer, and each
 * block is the same shape: type it, attach a picture of it, or both.
 *
 * The **question** needs one of the two — retyping a worksheet is the slowest
 * part of setting work, so a photo alone is a whole question. The **answer**
 * is optional entirely: it is never shown to a student — it goes to the AI
 * tutor so its guidance steers toward the answer the teacher actually wants,
 * rather than whatever the model would have decided on its own.
 *
 * Both text fields take LaTeX ($…$, $$…$$, \(…\), \[…\]) anywhere in the
 * prose, and a preview appears under the box the moment a formula shows up —
 * only then, because a teacher typing plain words has nothing to preview and
 * the box would be noise. Students see the rendered mathematics; the model is
 * handed the source, which it reads natively.
 *
 * This form used to carry four more controls: a question kind, a
 * worked-on-paper flag, a per-criterion mark scheme, and a set of hints to
 * release one at a time. They are gone. Setting work should take as long as
 * typing the question, and everything that made it take longer than that was
 * optional anyway. The API still accepts all four, and questions authored
 * earlier keep whatever they were given.
 */

/**
 * One attached picture: the button when there is none, the thumbnail and a
 * remove when there is. `shown` is what would be kept on save — the fresh
 * upload, or the stored one.
 */
function PicturePicker({ id, shown, error, onPick, onRemove }) {
  const t = useT()

  return (
    <>
      {shown ? (
        <div className="cs-qimage">
          <img
            src={shown.preview ?? shown.url}
            alt={shown.name}
            className="cs-qimage-thumb"
          />
          <div className="cs-qimage-meta">
            <p className="cs-qimage-name">{shown.name}</p>
            {shown.size ? <p className="cs-hint mono">{formatBytes(shown.size)}</p> : null}
          </div>
          <button type="button" className="cs-btn cs-btn-sm cs-btn-danger" onClick={onRemove}>
            {t('common.remove')}
          </button>
        </div>
      ) : (
        <label className="cs-attach" htmlFor={id}>
          <input
            id={id}
            className="sr-only"
            type="file"
            accept={ACCEPT}
            onChange={(event) => {
              onPick(event.target.files)
              event.target.value = ''
            }}
          />
          <span aria-hidden="true">＋</span> {t('qform.attach')}
        </label>
      )}

      {error ? (
        <p className="cs-note" data-tone="bad" role="alert">
          {error}
        </p>
      ) : null}
    </>
  )
}

/** The rendered mathematics, shown only once there is any to render. */
function MathPreview({ text }) {
  const t = useT()
  if (!hasMath(text)) return null

  return (
    <div className="cs-math-preview">
      <span className="cs-math-preview-tag">{t('qform.preview')}</span>
      <p className="cs-math-preview-body">
        <MathText text={text} />
      </p>
    </div>
  )
}

export default function QuestionForm({ question, onSave, onCancel, busy }) {
  const t = useT()
  const [prompt, setPrompt] = useState(question?.prompt ?? '')
  const [answer, setAnswer] = useState(question?.answer ?? '')

  // `undefined` means "leave whatever is stored alone", which is what the API
  // wants too — so the three states line up and nothing has to be translated.
  const [images, setImages] = useState({ image: undefined, answerImage: undefined })
  const [imageErrors, setImageErrors] = useState({ image: null, answerImage: null })
  const [error, setError] = useState(null)

  /** What would be kept on save: the new upload, or the stored one, or nothing. */
  const shown = (field) =>
    images[field] === undefined ? (question?.[field] ?? null) : images[field]

  const asksSomething = Boolean(prompt.trim() || shown('image'))

  const pick = (field) => async (fileList) => {
    const { accepted, rejected } = partitionFiles(Array.from(fileList ?? []))
    if (rejected.length) {
      setImageErrors((prior) => ({ ...prior, [field]: `${rejected[0].name} ${rejected[0].reason}.` }))
      return
    }
    if (!accepted.length) return

    const file = accepted[0]
    setImageErrors((prior) => ({ ...prior, [field]: null }))
    try {
      const picked = {
        name: file.name,
        type: file.type,
        size: file.size,
        dataUrl: await readAsDataUrl(file),
        // Shown immediately; a stored one comes back with a url instead.
        preview: URL.createObjectURL(file),
      }
      setImages((prior) => ({ ...prior, [field]: picked }))
    } catch (failure) {
      setImageErrors((prior) => ({ ...prior, [field]: failure.message }))
    }
  }

  const remove = (field) => () => {
    if (images[field]?.preview) URL.revokeObjectURL(images[field].preview)
    setImages((prior) => ({ ...prior, [field]: null }))
    setImageErrors((prior) => ({ ...prior, [field]: null }))
  }

  /** Omitted entirely when untouched, so editing the wording does not
      re-upload a picture that has not changed. */
  const imagePatch = (field) =>
    images[field] === undefined
      ? {}
      : {
          [field]: images[field] && {
            name: images[field].name,
            dataUrl: images[field].dataUrl,
          },
        }

  const submit = async (event) => {
    event.preventDefault()
    if (!asksSomething) return

    setError(null)

    try {
      await onSave({
        prompt,
        answer,
        ...imagePatch('image'),
        ...imagePatch('answerImage'),
      })
    } catch (failure) {
      setError(failure.message)
    }
  }

  return (
    <form className="cs-form" onSubmit={submit}>
      <div className="cs-field">
        <label className="cs-label" htmlFor="q-prompt">
          {t('qform.question')}
        </label>
        <textarea
          id="q-prompt"
          className="cs-textarea"
          rows={4}
          maxLength={LIMITS.prompt}
          placeholder={t('qform.placeholder')}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
        />
        <MathPreview text={prompt} />
        <PicturePicker
          id="q-image"
          shown={shown('image')}
          error={imageErrors.image}
          onPick={pick('image')}
          onRemove={remove('image')}
        />
        <p className="cs-hint">{t('qform.promptHint')}</p>
      </div>

      <div className="cs-field">
        <label className="cs-label" htmlFor="q-answer">
          {t('qform.answer')}
        </label>
        <textarea
          id="q-answer"
          className="cs-textarea"
          rows={3}
          maxLength={LIMITS.answer}
          placeholder={t('qform.answerPlaceholder')}
          value={answer}
          onChange={(event) => setAnswer(event.target.value)}
        />
        <MathPreview text={answer} />
        <PicturePicker
          id="q-answer-image"
          shown={shown('answerImage')}
          error={imageErrors.answerImage}
          onPick={pick('answerImage')}
          onRemove={remove('answerImage')}
        />
        <p className="cs-hint">{t('qform.answerHint')}</p>
      </div>

      {error ? (
        <p className="cs-note" data-tone="bad" role="alert">
          {error}
        </p>
      ) : null}
      {!asksSomething ? <p className="cs-hint">{t('qform.needSomething')}</p> : null}

      <div className="cs-actions">
        <button type="submit" className="cs-btn cs-btn-primary" disabled={busy || !asksSomething}>
          {busy ? t('common.saving') : question ? t('qform.saveChanges') : t('qform.add')}
        </button>
        <button type="button" className="cs-btn" onClick={onCancel}>
          {t('common.cancel')}
        </button>
      </div>
    </form>
  )
}
