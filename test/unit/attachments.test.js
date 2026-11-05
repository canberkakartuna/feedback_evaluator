import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MAX_BYTES, formatBytes, isImage, partitionFiles, photoType } from '../../src/lib/attachments.js'

/** A File-shaped object; partitionFiles only reads name, type and size. */
const file = (name, type, size = 1000) => ({ name, type, size })

test('photoType accepts the stored photo formats', () => {
  for (const type of ['image/jpeg', 'image/png', 'image/webp', 'image/heic']) {
    assert.equal(photoType(file('a', type)), type)
  }
})

test('photoType maps HEIF and an untyped iPhone HEIC to image/heic', () => {
  assert.equal(photoType(file('a.heif', 'image/heif')), 'image/heic')
  assert.equal(photoType(file('IMG_1.HEIC', '')), 'image/heic')
  assert.equal(photoType(file('IMG_1.heif', '')), 'image/heic')
})

test('photoType refuses PDFs, SVGs and untyped non-HEIC files', () => {
  assert.equal(photoType(file('a.pdf', 'application/pdf')), null)
  assert.equal(photoType(file('a.svg', 'image/svg+xml')), null)
  assert.equal(photoType(file('a.jpg', '')), null)
})

test('isImage lets SVG through for display', () => {
  assert.equal(isImage('image/svg+xml'), true)
  assert.equal(isImage('application/pdf'), false)
})

test('partitionFiles with photosOnly rejects non-photos with a readable reason', () => {
  const { accepted, rejected } = partitionFiles(
    [file('ok.jpg', 'image/jpeg'), file('work.pdf', 'application/pdf')],
    { photosOnly: true },
  )
  assert.deepEqual(accepted.map((f) => f.name), ['ok.jpg'])
  assert.deepEqual(rejected, [{ name: 'work.pdf', reason: 'is not a photo (JPG, PNG, WebP or HEIC)' }])
})

test('partitionFiles without photosOnly accepts PDFs and rejects other types', () => {
  const { accepted, rejected } = partitionFiles([
    file('q.pdf', 'application/pdf'),
    file('notes.txt', 'text/plain'),
  ])
  assert.deepEqual(accepted.map((f) => f.name), ['q.pdf'])
  assert.deepEqual(rejected, [{ name: 'notes.txt', reason: 'is not a JPG, PNG or PDF' }])
})

test('partitionFiles rejects files over 10 MB and keeps exactly 10 MB', () => {
  const { accepted, rejected } = partitionFiles([
    file('edge.jpg', 'image/jpeg', MAX_BYTES),
    file('big.jpg', 'image/jpeg', MAX_BYTES + 1),
  ])
  assert.deepEqual(accepted.map((f) => f.name), ['edge.jpg'])
  assert.deepEqual(rejected, [{ name: 'big.jpg', reason: 'is larger than 10 MB' }])
})

test('formatBytes picks B, KB or MB', () => {
  assert.equal(formatBytes(512), '512 B')
  assert.equal(formatBytes(2048), '2 KB')
  assert.equal(formatBytes(3.5 * 1024 * 1024), '3.5 MB')
})
