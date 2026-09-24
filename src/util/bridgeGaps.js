/**
 * @param {{ timestamp: string | Date; duration: number }[]} events
 * @param {number} breakTimeSeconds
 */
export function bridgeGaps(events, breakTimeSeconds) {
  if (!Array.isArray(events) || !Number.isFinite(breakTimeSeconds) || breakTimeSeconds < 0) {
    throw new TypeError('Work Report event intervals or break threshold are invalid.');
  }
  const sorted = events
    .map(event => {
      const timestamp = new Date(event?.timestamp).getTime();
      const duration = event?.duration;
      if (!Number.isFinite(timestamp) || typeof duration !== 'number'
          || !Number.isFinite(duration) || duration < 0) {
        throw new TypeError('Work Report event intervals must have valid timestamps and non-negative durations.');
      }
      return { timestamp, duration };
    })
    .sort((left, right) => left.timestamp - right.timestamp);
  if (sorted.length < 2 || breakTimeSeconds === 0) return 0;
  let extra = 0;
  for (let index = 1; index < sorted.length; index++) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    const gap = (current.timestamp - (previous.timestamp + previous.duration * 1000)) / 1000;
    if (gap > 0 && gap <= breakTimeSeconds) extra += gap;
  }
  return extra;
}
