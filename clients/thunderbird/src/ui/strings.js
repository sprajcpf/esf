/**
 * User-facing wording for the send-time progress surface, in one place.
 *
 * Why one place: the label for what the add-on is doing while it computes is a positioning decision, not a string.
 * "Mining" is the most recognisable word available and technically exact - it is the same SHA-256 nonce search as
 * cryptocurrency mining. It also carries baggage the project cannot afford in a primary surface: cryptojacking
 * trained users and IT departments that "this program is mining" means "this program is compromised", it implies the
 * user or the vendor earns something (nothing is earned; the cost is the entire point), and the whitepaper itself
 * distances ESF from mining rewards and consensus in section 2.1.
 *
 * The compromise implemented here: plain language in the headline, the word "mining" where a curious user goes
 * looking, with the comparison made explicitly and the difference stated. Switching to "mining" as the primary label
 * is a one-line change - set PRIMARY_LABEL to MINING_LABEL.
 */

/** Plain-language label. Says what happens without inviting the crypto reading. */
export const STAMPING_LABEL = "Creating proof of work";

/** The recognisable alternative, kept next to it so the choice stays visible and reversible. */
export const MINING_LABEL = "Mining stamp";

/** The label actually used in the headline. */
export const PRIMARY_LABEL = STAMPING_LABEL;

/** The comparison, for the details view: it explains the wait by reference to something people know. */
export const MINING_EXPLANATION =
  "This is the same computation as cryptocurrency mining - searching for a number whose hash starts with enough " +
  "zero bits - which is why it takes a moment and warms your CPU. The difference: nothing is earned, nothing is " +
  "transmitted, and no network is involved. The cost is the entire point, because it is what makes sending a " +
  "million of these expensive.";

/** Why there is no percentage. Shown in the details view, because it is the obvious question. */
export const MEMORYLESS_EXPLANATION =
  "There is no progress bar because there is no progress to report: every attempt has the same chance of " +
  "succeeding, so work already done does not bring the result closer. What is shown is how long this usually takes " +
  "on this machine.";

export const HEADLINES = {
  computing: PRIMARY_LABEL,
  asking: "This is taking longer than usual",
  done: "Proof of work attached",
  skipped: "Sent without a proof of work",
  cancelled: "Send cancelled"
};
