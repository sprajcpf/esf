/**
 * User-facing wording for the send-time progress surface and the sender suggestion, in one place.
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

/**
 * The suggestion offered to a sender whose message carried no accepted stamp.
 *
 * Rules this text follows, in order of importance:
 *
 *  - **No jargon.** Not one word: no hash, nonce, bits, algorithm, header or "proof of work". The reader is a person
 *    who received an email, not someone who wants a protocol lesson. A test enforces this.
 *  - **A comparison they already have.** Postage is not a metaphor invented for the occasion - it is where the idea
 *    came from, and everyone has felt the difference between their letterbox and their inbox.
 *  - **Short.** Anything longer reads as a lecture and gets deleted.
 *  - **No demand, no accusation.** It opens by saying the message arrived fine and closes by asking for nothing.
 *
 * Formatting matters as much as wording. Each paragraph is **one unbroken line**, because a mail client wraps plain
 * text to the reader's window; pre-wrapping it in the template produces the ragged, broken-mid-sentence look of a
 * machine-generated message - which is the opposite of the impression this text exists to make.
 *
 * It is always opened as a *draft*. The add-on never sends anything by itself.
 */

const MISSING_PARAGRAPHS = url => [
  "Hi,",

  "your message arrived fine - nothing wrong with it.",

  "Something I keep wondering about: my letterbox gets a couple of adverts a week, my inbox gets hundreds. " +
  "The difference is that someone had to buy a stamp for the paper ones. Email costs the sender nothing, so " +
  "nothing stops anyone sending a million.",

  "ESF puts the stamp back. Not money - a couple of seconds of computer time per message. Sending this one to " +
  "you: I didn't notice it. Sending a million: more than a month of a computer running flat out, and the " +
  "advertiser has to pay for that.",

  "It's free and open source, if you'd like your mail to carry one too:",

  url,

  "No need to reply."
];

const INVALID_PARAGRAPHS = (url, reason) => [
  "Hi,",

  `your message came with an ESF stamp, but it didn't check out on my side${reason ? ` - my client said: ${reason}` : ""}.`,

  "Your message itself arrived fine. Since we're both running this, it seemed worth telling you; usually it " +
  "turns out to be a difference in setup or versions.",

  url
];

export const SUGGESTION = {
  missing: {
    subject: "Why my inbox gets more junk than my letterbox",
    /** @param {string} url @returns {string} plain text body, one line per paragraph */
    body: url => MISSING_PARAGRAPHS(url).join("\n\n")
  },
  invalid: {
    subject: "Your ESF stamp didn't check out here",
    /** @param {string} url @param {string} [reason] the verifier's own words for what failed */
    body: (url, reason) => INVALID_PARAGRAPHS(url, reason).join("\n\n")
  }
};
