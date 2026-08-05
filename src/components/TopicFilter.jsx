import { useMemo } from 'react'
import { TOPICS } from '../../shared/activity'
import { useT } from '../lib/i18n'
import './Chrome.css'

/** null is a real bucket — "no topic" — so it needs a key a Map can hold. */
const NO_TOPIC = 'none'

const topicKey = (topic) => topic ?? NO_TOPIC

/**
 * Counts per topic, so the chips can say how much is behind each one and hide
 * the ones with nothing behind them.
 */
function countByTopic(activities) {
  const counts = new Map()
  for (const activity of activities) {
    const key = topicKey(activity.topic)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

export const matchesTopic = (activity, selected) =>
  selected === 'all' || topicKey(activity.topic) === selected

/**
 * Filter a list of activities by what they are about.
 *
 * Chips rather than a `<select>`: there are three or four of them, the counts are
 * the useful part, and a student picking one should not have to open a menu to
 * find out the list is only twelve long. A topic with nothing in it is left out
 * entirely — an empty bucket is a dead end, and offering it teaches the reader
 * nothing except that they can click something that does nothing.
 *
 * The labels come from `topics.<id>` in src/lib/strings.js, keyed by the id in
 * shared/activity.js. A topic added there with no string added here shows its own
 * id, which is the same deal every other key gets.
 */
export default function TopicFilter({ activities, value, onChange, label }) {
  const t = useT()
  const counts = useMemo(() => countByTopic(activities), [activities])

  const options = [
    { id: 'all', label: t('topics.all'), count: activities.length },
    ...TOPICS.filter((topic) => counts.get(topic.id)).map((topic) => ({
      id: topic.id,
      label: t(`topics.${topic.id}`),
      count: counts.get(topic.id),
    })),
    ...(counts.get(NO_TOPIC)
      ? [{ id: NO_TOPIC, label: t('topics.none'), count: counts.get(NO_TOPIC) }]
      : []),
  ]

  // One bucket is not a choice. Nothing is gained by asking someone to filter a
  // list that has only ever had one kind of thing in it.
  if (options.length < 3) return null

  return (
    <div className="ch-filter" role="group" aria-label={label ?? t('topics.label')}>
      <p className="eyebrow ch-filter-label">{label ?? t('topics.label')}</p>

      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          className="ch-chip"
          aria-pressed={value === option.id}
          onClick={() => onChange(option.id)}
        >
          <span>{option.label}</span>
          <span className="ch-chip-count">{option.count}</span>
        </button>
      ))}
    </div>
  )
}
