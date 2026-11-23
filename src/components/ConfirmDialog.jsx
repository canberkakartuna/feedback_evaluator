import { useEffect, useRef } from 'react'

/**
 * A yes/no question asked before something that cannot be taken back, as a
 * modal over the page (a native `<dialog>`, as the whiteboard uses).
 *
 * It replaced a confirmation drawn inside the table row on the People page:
 * that grew the row to twice its height and widened every column the moment
 * Delete was pressed, so the table jumped under the pointer. A modal leaves the
 * table exactly as it was.
 *
 * Focus starts on Cancel, the harmless answer. Escape, Cancel and a press on
 * the backdrop all cancel; none of them do while `busy`, so the answer to a
 * request already sent cannot be thrown away. When it closes, focus goes back
 * to whatever had it when it opened (the row's Delete button), if that is still
 * on the page.
 *
 * Rendered only while open: mount it with `{target ? <ConfirmDialog …/> : null}`.
 */
export default function ConfirmDialog({ title, detail, body, confirmLabel, cancelLabel, busy, onConfirm, onCancel }) {
  const dialog = useRef(null)
  const cancelButton = useRef(null)
  const busyRef = useRef(busy)
  busyRef.current = busy

  useEffect(() => {
    const opener = document.activeElement
    const node = dialog.current
    node?.showModal()
    cancelButton.current?.focus()
    return () => {
      if (node?.open) node.close()
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
    }
  }, [])

  const cancel = () => {
    if (!busyRef.current) onCancel()
  }

  return (
    <dialog
      ref={dialog}
      className="cs-dialog"
      role="alertdialog"
      aria-labelledby="cs-dialog-title"
      aria-describedby={body ? 'cs-dialog-body' : undefined}
      onCancel={(event) => {
        // Escape. The page decides whether the dialog goes, not the browser.
        event.preventDefault()
        cancel()
      }}
      onClick={(event) => {
        // The panel fills the dialog box, so only the backdrop hits it directly.
        if (event.target === dialog.current) cancel()
      }}
    >
      <div className="cs-dialog-panel">
        <h2 id="cs-dialog-title" className="cs-dialog-title">
          {title}
        </h2>
        {detail ? <p className="cs-dialog-detail mono">{detail}</p> : null}
        {body ? (
          <p id="cs-dialog-body" className="cs-dialog-body">
            {body}
          </p>
        ) : null}
        <div className="cs-dialog-actions">
          <button ref={cancelButton} type="button" className="cs-btn" disabled={busy} onClick={cancel}>
            {cancelLabel}
          </button>
          <button type="button" className="cs-btn cs-btn-danger" disabled={busy} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  )
}
