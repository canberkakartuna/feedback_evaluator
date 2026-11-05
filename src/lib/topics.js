/**
 * Which topic bucket an activity falls in, shared by TopicFilter (which counts
 * them) and the lists it filters (which match against the chosen one).
 */

/** null is a real bucket — "no topic" — so it needs a key a Map can hold. */
export const NO_TOPIC = 'none'

export const topicKey = (topic) => topic ?? NO_TOPIC

export const matchesTopic = (activity, selected) =>
  selected === 'all' || topicKey(activity.topic) === selected
