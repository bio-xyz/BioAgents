/**
 * Retry-in-progress marker shared between the manual chat retry endpoint
 * and the message sweeper.
 *
 * The retry endpoint must reset the message row from FAILED to PENDING
 * before calling `job.retry()`, otherwise the worker's markMessageComplete
 * would no-op against a FAILED row. Without coordination, the sweeper can
 * race that reset: it sees PENDING + a non-alive BullMQ state and flips
 * the row straight back to FAILED while the retry is in flight.
 *
 * The retry endpoint sets this marker in Redis before the reset; the
 * sweeper treats its presence as "alive" and skips the candidate. TTL is
 * the natural cleanup so we don't need an explicit clear on the success
 * path (BullMQ state will already be `waiting`/`active` by then, which
 * the sweeper already treats as alive).
 */
const RETRY_IN_PROGRESS_KEY_PREFIX = "chat-retry-in-progress:";

export const CHAT_RETRY_MARKER_TTL_SECONDS = 60;

export function chatRetryMarkerKey(messageId: string): string {
  return `${RETRY_IN_PROGRESS_KEY_PREFIX}${messageId}`;
}
