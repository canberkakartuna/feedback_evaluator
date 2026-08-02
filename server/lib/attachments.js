import path from 'node:path'
import { config } from '../config.js'
import { badRequest } from './http.js'

/**
 * Decoding and checking a base64 data URL, wherever one arrives.
 *
 * Two places send them and they have to agree: a **student** photographing
 * their working, and a **teacher** uploading a question they did not want to
 * retype. Same formats, same size ceiling, same refusals — a teacher hitting a
 * different limit than their class would be a bug nobody would find until a
 * lesson was already running.
 */

export const EXTENSIONS = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'application/pdf': 'pdf',
}

export function decodeDataUrl(value) {
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(value ?? '')
  if (!match) throw badRequest('"dataUrl" must be a base64 data URL')

  const [, type, base64] = match
  if (!EXTENSIONS[type]) {
    throw badRequest(`Unsupported type "${type}". Send a JPG, PNG, WebP, HEIC or PDF.`)
  }

  const bytes = Buffer.from(base64, 'base64')
  if (!bytes.length) throw badRequest('Attachment is empty')
  if (bytes.length > config.maxUploadBytes) {
    throw badRequest(
      `Attachment is ${(bytes.length / 1024 / 1024).toFixed(1)} MB; the limit is ${(config.maxUploadBytes / 1024 / 1024).toFixed(0)} MB.`,
    )
  }

  return { type, bytes }
}

/** `basename` so an uploaded name cannot carry a path out of its prefix. */
export function safeName(value, type) {
  return typeof value === 'string' && value.trim()
    ? path.basename(value).slice(0, 200)
    : `upload.${EXTENSIONS[type]}`
}
