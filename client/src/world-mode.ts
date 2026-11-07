/** The town is home; the arena is an explicit destination. */
export function isTownMode(params: URLSearchParams): boolean {
  return params.has('town') || !params.has('arena');
}
