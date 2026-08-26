/**
 * User-facing wording for the send-time progress surface, in one place.
 *
 * One decision is recorded here rather than in a commit message, because it will come up again: the word "mining" is
 * deliberately absent from every string in this file.
 *
 * It would be the most recognisable word available, and technically exact - the search really is the same SHA-256
 * nonce hunt as cryptocurrency mining. It is left out anyway. Cryptojacking taught users and IT departments that a
 * program which "mines" is a program that has been compromised, which is a poor first impression for a mail add-on
 * that wants to be deployed by administrators. It also implies an earning: miners are paid, while here the cost is
 * the entire product and nobody is paid at all. And the whitepaper distances ESF from mining rewards and consensus
 * in section 2.1, so putting the word in the primary surface would contradict the project's own framing.
 *
 * The wait is therefore explained by what it actually is - a search - which needs no borrowed vocabulary.
 */

/** What the add-on is doing, in words that need no background. */
export const PRIMARY_LABEL = "Creating proof of work";

/** What the computer is actually doing, for the details view. No analogies required. */
export const WORK_EXPLANATION =
  "Your computer is trying numbers until one of them produces a fingerprint that begins with enough zeroes. There " +
  "is no shortcut, which is the point: finding one costs a measurable amount of computing time, while checking it " +
  "costs the recipient almost nothing. That difference is what makes sending a million of these expensive and " +
  "sending this one cheap.";

/** Why there is no percentage. Shown in the details view, because it is the obvious question. */
export const MEMORYLESS_EXPLANATION =
  "There is no progress bar because there is no progress to report: every attempt has the same chance of " +
  "succeeding, so work already done does not bring the result closer. What is shown instead is how long this " +
  "usually takes on this machine.";

export const HEADLINES = {
  computing: PRIMARY_LABEL,
  asking: "This is taking longer than usual",
  done: "Proof of work attached",
  skipped: "Sent without a proof of work",
  cancelled: "Send cancelled"
};
