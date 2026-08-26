/**
 * Making an instant operation legible.
 *
 * Verifying a stamp is one hash, and a repeat verification usually comes out of a cache, so it finishes far faster
 * than a person can perceive. Feedback that appears and disappears within a frame is the same as no feedback: the
 * user presses the button and cannot tell whether anything happened, so they press it again.
 *
 * The fix is a floor, not a fake delay: the work starts immediately and the *result* is held back until the feedback
 * has been visible long enough to register. Work that takes longer than the floor is never slowed down.
 */

/** Long enough to be seen, short enough not to feel like waiting. */
export const MINIMUM_FEEDBACK_MS = 500;

/**
 * Resolves with `promise`'s value, but no sooner than `minimumMs` from now.
 *
 * A rejection is held back the same way, so an error message does not flash past either.
 *
 * @template T
 * @param {Promise<T>} promise
 * @param {number} [minimumMs]
 * @returns {Promise<T>}
 */
export async function atLeast(promise, minimumMs = MINIMUM_FEEDBACK_MS) {
  const floor = new Promise(resolve => setTimeout(resolve, Math.max(0, minimumMs)));
  const [outcome] = await Promise.all([promise.then(
    value => ({ value }),
    error => ({ error })
  ), floor]);
  if ("error" in outcome) {
    throw outcome.error;
  }
  return outcome.value;
}
