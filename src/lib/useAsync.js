import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Load something once, expose `{ data, error, loading, reload, setData }`.
 *
 * Every console screen does the same four things — fetch on mount, show a
 * spinner, show the failure, refetch after a write — and doing them by hand in
 * each one is where stale-state bugs come from. Two details worth knowing:
 *
 * - **Results from a superseded request are dropped.** A screen that reloads
 *   twice quickly would otherwise be able to render the first answer over the
 *   second, which reads as a write that silently did not happen.
 * - **`setData` is exposed** so a screen can fold a write's response straight
 *   into the list instead of refetching everything to move one row.
 */
export function useAsync(fetcher, deps = []) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  // Bumped per request; only the newest one is allowed to land.
  const generation = useRef(0)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const run = useCallback(async () => {
    const mine = (generation.current += 1)
    setLoading(true)

    try {
      const result = await fetcher()
      if (!alive.current || mine !== generation.current) return
      setData(result)
      setError(null)
    } catch (problem) {
      if (!alive.current || mine !== generation.current) return
      setError(problem)
    } finally {
      if (alive.current && mine === generation.current) setLoading(false)
    }
    // The caller owns the dependency list, the same way useEffect works.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  useEffect(() => {
    run()
  }, [run])

  return { data, error, loading, reload: run, setData }
}
