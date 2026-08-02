import { useState } from 'react'
import { LIMITS } from '../../../shared/activity'
import { ACCEPT, formatBytes, partitionFiles, readAsDataUrl } from '../../lib/attachments'

/**
 * Writing or editing one question.
 *
 * Two fields, and a question needs **one** of them: type it, or photograph it
 * off a worksheet and upload that. Both together is fine — a diagram with a
 * line of instruction over it — but neither is refused.
 *
 * This form used to carry four more controls: a question kind, a
 * worked-on-paper flag, a per-criterion mark scheme, and a set of hints to
 * release one at a time. They are gone. Setting work should take as long as
 * typing the question, and everything that made it take longer than that was
 * optional anyway.
 *
 * The API still accepts all four, and questions authored earlier keep whatever
 * they were given — this stopped sending them, it did not delete them. What
 * that means in practice is that new questions are unmarked and the tutor
 * answers from the system prompt, which is the path the whole application
 * already supports and the smoke test already covers.
 */
export default function QuestionForm({ question, onSave, onCancel, busy }) {
  const [prompt, setPrompt] = useState(question?.prompt ?? '')

  // `undefined` means "leave whatever is stored alone", which is what the API
  // wants too — so the three states line up and nothing has to be translated.
  const [image, setImage] = useState(undefined)
  const [imageError, setImageError] = useState(null)
  const [error, setError] = useState(null)

  /** What the student would see: the new upload, or the stored one, or nothing. */
  const shownImage = image === undefined ? (question?.image ?? null) : image
  const asksSomething = Boolean(prompt.trim() || shownImage)

  const pickImage = async (fileList) => {
    const { accepted, rejected } = partitionFiles(Array.from(fileList ?? []))
    if (rejected.length) {
      setImageError(`${rejected[0].name} ${rejected[0].reason}.`)
      return
    }
    if (!accepted.length) return

    const file = accepted[0]
    setImageError(null)
    try {
      setImage({
        name: file.name,
        type: file.type,
        size: file.size,
        dataUrl: await readAsDataUrl(file),
        // Shown immediately; a stored one comes back with a url instead.
        preview: URL.createObjectURL(file),
      })
    } catch (failure) {
      setImageError(failure.message)
    }
  }

  const submit = async (event) => {
    event.preventDefault()
    if (!asksSomething) return

    setError(null)

    try {
      await onSave({
        prompt,
        // Omitted entirely when untouched, so editing the wording does not
        // re-upload a picture that has not changed.
        ...(image === undefined
          ? {}
          : { image: image && { name: image.name, dataUrl: image.dataUrl } }),
      })
    } catch (failure) {
      setError(failure.message)
    }
  }

  return (
    <form className="cs-form" onSubmit={submit}>
      <div className="cs-field">
        <label className="cs-label" htmlFor="q-prompt">
          Question
        </label>
        <textarea
          id="q-prompt"
          className="cs-textarea"
          rows={4}
          maxLength={LIMITS.prompt}
          placeholder="A red blood cell is placed in distilled water. Explain why it bursts."
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
        />
        <p className="cs-hint">
          Leave this empty if you are uploading the question as a picture instead.
        </p>
      </div>

      <div className="cs-field">
        <label className="cs-label" htmlFor="q-image">
          Or upload the question
        </label>

        {shownImage ? (
          <div className="cs-qimage">
            <img
              src={shownImage.preview ?? shownImage.url}
              alt={shownImage.name}
              className="cs-qimage-thumb"
            />
            <div className="cs-qimage-meta">
              <p className="cs-qimage-name">{shownImage.name}</p>
              {shownImage.size ? (
                <p className="cs-hint mono">{formatBytes(shownImage.size)}</p>
              ) : null}
            </div>
            <button
              type="button"
              className="cs-btn cs-btn-sm cs-btn-danger"
              onClick={() => {
                if (image?.preview) URL.revokeObjectURL(image.preview)
                setImage(null)
                setImageError(null)
              }}
            >
              Remove
            </button>
          </div>
        ) : (
          <input
            id="q-image"
            className="cs-input"
            type="file"
            accept={ACCEPT}
            onChange={(event) => pickImage(event.target.files)}
          />
        )}

        <p className="cs-hint">A photo or scan of the question. JPG, PNG or PDF, up to 10 MB.</p>
        {imageError ? (
          <p className="cs-note" data-tone="bad" role="alert">
            {imageError}
          </p>
        ) : null}
      </div>

      {error ? (
        <p className="cs-note" data-tone="bad" role="alert">
          {error}
        </p>
      ) : null}
      {!asksSomething ? (
        <p className="cs-hint">Write the question above, or upload a picture of it.</p>
      ) : null}

      <div className="cs-actions">
        <button type="submit" className="cs-btn cs-btn-primary" disabled={busy || !asksSomething}>
          {busy ? 'Saving…' : question ? 'Save changes' : 'Add question'}
        </button>
        <button type="button" className="cs-btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}
