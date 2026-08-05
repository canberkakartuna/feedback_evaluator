import { useEffect, useRef, useState } from 'react'
import {
  ERASER_WIDTH,
  INKS,
  PEN_WIDTH,
  drawGrid,
  drawStrokes,
  exportBoardImage,
  fitCanvas,
  pointFrom,
} from '../lib/board'
import { useT } from '../lib/i18n'
import './Whiteboard.css'

const UNDO_LIMIT = 40

/** `graphite` → `wb.inkGraphite`; the swatch names live in strings.js. */
const inkKey = (id) => `wb.ink${id.charAt(0).toUpperCase()}${id.slice(1)}`

export default function Whiteboard({ question, initialStrokes, onSave, onClose }) {
  const t = useT()
  const dialog = useRef(null)
  const gridCanvas = useRef(null)
  const inkCanvas = useRef(null)

  const live = useRef(null) // stroke in progress, kept off state so moves stay cheap
  const frame = useRef(0)

  const [strokes, setStrokes] = useState(initialStrokes)
  const [past, setPast] = useState([])
  const [tool, setTool] = useState('pen')
  const [color, setColor] = useState(INKS[0].value)

  const committed = useRef(strokes)
  committed.current = strokes

  useEffect(() => {
    dialog.current?.showModal()
  }, [])

  /* Paint, and repaint whenever the board is resized. */
  useEffect(() => {
    const paint = () => {
      if (!gridCanvas.current || !inkCanvas.current) return
      drawGrid(fitCanvas(gridCanvas.current))
      render()
    }

    paint()
    const observer = new ResizeObserver(paint)
    observer.observe(inkCanvas.current)

    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    render()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strokes])

  function render() {
    const canvas = inkCanvas.current
    if (!canvas) return
    const all = live.current ? [...committed.current, live.current] : committed.current
    drawStrokes(fitCanvas(canvas), all)
  }

  function schedule() {
    if (frame.current) return
    frame.current = requestAnimationFrame(() => {
      frame.current = 0
      render()
    })
  }

  const startStroke = (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return

    // Keeps a stroke going if the pointer leaves the canvas mid-draw. Not all
    // pointers can be captured, and failing to is not worth dropping the stroke.
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      /* draw without capture */
    }

    live.current = {
      tool,
      color,
      width: tool === 'eraser' ? ERASER_WIDTH : PEN_WIDTH,
      points: [pointFrom(event, inkCanvas.current)],
    }
    schedule()
  }

  const extendStroke = (event) => {
    if (!live.current) return
    live.current.points.push(pointFrom(event, inkCanvas.current))
    schedule()
  }

  const endStroke = () => {
    const stroke = live.current
    if (!stroke) return

    live.current = null
    setPast((prev) => [...prev, committed.current].slice(-UNDO_LIMIT))
    setStrokes((prev) => [...prev, stroke])
  }

  const undo = () => {
    if (!past.length) return
    setStrokes(past[past.length - 1])
    setPast(past.slice(0, -1))
  }

  const clear = () => {
    if (!strokes.length) return
    setPast((prev) => [...prev, strokes].slice(-UNDO_LIMIT))
    setStrokes([])
  }

  const save = () => {
    if (!strokes.length) {
      onSave([], null)
      return
    }

    onSave(strokes, exportBoardImage(strokes, `whiteboard-${question.code.toLowerCase()}.png`))
  }

  return (
    <dialog
      className="wb"
      ref={dialog}
      aria-label={t('wb.forQuestion', { code: question.code })}
      onCancel={onClose}
    >
      <header className="wb-head">
        <div>
          <p className="eyebrow">{t('wb.title')}</p>
          <p className="wb-scope">
            {t('wb.workingOn')} <span className="mono">{question.code}</span>
          </p>
        </div>

        <div className="wb-tools">
          <div className="wb-group" role="group" aria-label={t('wb.penColour')}>
            {INKS.map((ink) => (
              <button
                key={ink.id}
                type="button"
                className="wb-ink-swatch"
                style={{ '--swatch': ink.value }}
                aria-label={t(inkKey(ink.id))}
                title={t(inkKey(ink.id))}
                aria-pressed={tool === 'pen' && color === ink.value}
                onClick={() => {
                  setTool('pen')
                  setColor(ink.value)
                }}
              />
            ))}
          </div>

          <div className="wb-group">
            <button
              type="button"
              className="wb-tool"
              aria-pressed={tool === 'eraser'}
              onClick={() => setTool('eraser')}
            >
              {t('wb.erase')}
            </button>
            <button type="button" className="wb-tool" disabled={!past.length} onClick={undo}>
              {t('wb.undo')}
            </button>
            <button type="button" className="wb-tool" disabled={!strokes.length} onClick={clear}>
              {t('wb.clear')}
            </button>
          </div>
        </div>
      </header>

      <p className="wb-rotate mono">{t('wb.rotate')}</p>

      <div className="wb-stage">
        <div className="wb-surface">
          <canvas className="wb-grid" ref={gridCanvas} aria-hidden="true" />
          <canvas
            className="wb-ink"
            ref={inkCanvas}
            role="img"
            aria-label={t('wb.canvasLabel')}
            onPointerDown={startStroke}
            onPointerMove={extendStroke}
            onPointerUp={endStroke}
            onPointerCancel={endStroke}
          />
        </div>
      </div>

      <footer className="wb-foot">
        <p className="wb-hint mono">
          {strokes.length
            ? t('wb.strokesSaved', {
                strokes: t('common.strokes', { count: strokes.length }),
              })
            : t('wb.drawHint')}
        </p>

        <div className="wb-actions">
          <button type="button" className="wb-btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className="wb-btn wb-btn-primary" onClick={save}>
            {t('wb.save')}
          </button>
        </div>
      </footer>
    </dialog>
  )
}
