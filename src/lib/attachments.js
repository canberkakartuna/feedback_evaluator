/** What the answer box accepts as uploaded working. */
export const MAX_BYTES = 10 * 1024 * 1024
export const ACCEPT = 'image/jpeg,image/png,image/heic,image/webp,application/pdf'

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/heic', 'image/webp', 'image/svg+xml']

export function isImage(type) {
  return IMAGE_TYPES.includes(type)
}

/**
 * Split a FileList into what can be attached and what cannot. Reasons are
 * written to complete the sentence "<name> <reason>." so the panel can name
 * the file and the fix in one line.
 */
export function partitionFiles(files) {
  const accepted = []
  const rejected = []

  for (const file of files) {
    if (!isImage(file.type) && file.type !== 'application/pdf') {
      rejected.push({ name: file.name, reason: 'is not a JPG, PNG or PDF' })
    } else if (file.size > MAX_BYTES) {
      rejected.push({ name: file.name, reason: 'is larger than 10 MB' })
    } else {
      accepted.push(file)
    }
  }

  return { accepted, rejected }
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
