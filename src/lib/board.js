/**
 * Whiteboard geometry and painting.
 *
 * Strokes are stored as vectors, not pixels, so a board can be reopened and
 * edited, undone stroke by stroke, and re-rendered at any size. Saving
 * rasterises to PNG so the working travels with the answer as an image.
 *
 * The board is a light paper surface in both themes: it is a sheet of paper
 * that gets handed in, and dark ink on dark paper would not survive export.
 */

export const BOARD_W = 1200
export const BOARD_H = 800
const GRID_STEP = 40
const MARGIN_X = GRID_STEP * 2

export const PEN_WIDTH = 3.2
export const ERASER_WIDTH = 28

const PAPER = '#fffdf7'
const GRID = '#dde4db'
const MARGIN_RULE = 'rgb(185 69 47 / 0.42)'

export const INKS = [
  { id: 'graphite', label: 'Graphite', value: '#1b2430' },
  { id: 'teal', label: 'Teal pen', value: '#0e7566' },
  { id: 'red', label: 'Red pen', value: '#b9452f' },
]

/** Squared paper with the same margin rule as the question page. */
export function drawGrid(ctx) {
  ctx.save()
  ctx.fillStyle = PAPER
  ctx.fillRect(0, 0, BOARD_W, BOARD_H)

  ctx.strokeStyle = GRID
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let x = GRID_STEP; x < BOARD_W; x += GRID_STEP) {
    ctx.moveTo(x, 0)
    ctx.lineTo(x, BOARD_H)
  }
  for (let y = GRID_STEP; y < BOARD_H; y += GRID_STEP) {
    ctx.moveTo(0, y)
    ctx.lineTo(BOARD_W, y)
  }
  ctx.stroke()

  ctx.strokeStyle = MARGIN_RULE
  ctx.lineWidth = 1.4
  ctx.beginPath()
  ctx.moveTo(MARGIN_X, 0)
  ctx.lineTo(MARGIN_X, BOARD_H)
  ctx.stroke()
  ctx.restore()
}

/**
 * Paint every stroke in order onto a transparent ink layer. Eraser strokes
 * are ordinary strokes drawn with destination-out, so replaying the list
 * reproduces exactly what the student saw — and keeps the grid untouched,
 * because the grid lives on its own layer underneath.
 */
export function drawStrokes(ctx, strokes) {
  ctx.save()
  ctx.clearRect(0, 0, BOARD_W, BOARD_H)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  for (const stroke of strokes) {
    ctx.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over'
    ctx.strokeStyle = stroke.color
    ctx.fillStyle = stroke.color
    ctx.lineWidth = stroke.width

    const points = stroke.points

    if (points.length < 2) {
      ctx.beginPath()
      ctx.arc(points[0][0], points[0][1], stroke.width / 2, 0, Math.PI * 2)
      ctx.fill()
      continue
    }

    // Curve through the midpoints, which keeps handwriting from looking faceted.
    ctx.beginPath()
    ctx.moveTo(points[0][0], points[0][1])
    for (let i = 1; i < points.length - 1; i += 1) {
      const midX = (points[i][0] + points[i + 1][0]) / 2
      const midY = (points[i][1] + points[i + 1][1]) / 2
      ctx.quadraticCurveTo(points[i][0], points[i][1], midX, midY)
    }
    ctx.lineTo(points[points.length - 1][0], points[points.length - 1][1])
    ctx.stroke()
  }

  ctx.restore()
}

/**
 * Match the bitmap to its displayed size times the device pixel ratio, then
 * scale the context so callers keep drawing in board coordinates.
 */
export function fitCanvas(canvas) {
  const rect = canvas.getBoundingClientRect()
  const ratio = window.devicePixelRatio || 1
  const width = Math.max(1, Math.round(rect.width * ratio))
  const height = Math.max(1, Math.round(rect.height * ratio))

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width
    canvas.height = height
  }

  const ctx = canvas.getContext('2d')
  const scale = width / BOARD_W
  ctx.setTransform(scale, 0, 0, scale, 0, 0)
  return ctx
}

/** Board coordinates for a pointer event over the ink canvas. */
export function pointFrom(event, canvas) {
  const rect = canvas.getBoundingClientRect()
  return [
    ((event.clientX - rect.left) / rect.width) * BOARD_W,
    ((event.clientY - rect.top) / rect.height) * BOARD_H,
  ]
}

/**
 * Flatten grid plus ink into a PNG, ready for the attachment list.
 *
 * Encoding synchronously via toDataURL rather than toBlob: there is no async
 * step that can leave the dialog stuck mid-save, and a data URL needs no
 * object-URL bookkeeping. The vector strokes remain the real record — this is
 * the picture that travels with the answer.
 */
export function exportBoardImage(strokes, name) {
  const scale = 2

  const page = document.createElement('canvas')
  page.width = BOARD_W * scale
  page.height = BOARD_H * scale
  const pageCtx = page.getContext('2d')
  pageCtx.setTransform(scale, 0, 0, scale, 0, 0)
  drawGrid(pageCtx)

  const ink = document.createElement('canvas')
  ink.width = page.width
  ink.height = page.height
  const inkCtx = ink.getContext('2d')
  inkCtx.setTransform(scale, 0, 0, scale, 0, 0)
  drawStrokes(inkCtx, strokes)

  pageCtx.setTransform(1, 0, 0, 1, 0, 0)
  pageCtx.drawImage(ink, 0, 0)

  const url = page.toDataURL('image/png')
  const base64 = url.slice(url.indexOf(',') + 1)

  return { name, type: 'image/png', url, size: Math.round(base64.length * 0.75) }
}
