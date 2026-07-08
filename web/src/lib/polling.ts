export function nextPollingDelay(failureCount: number): number {
  if (failureCount <= 0) return 2000;
  if (failureCount === 1) return 5000;
  return 10000;
}
