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
 *
 * ## Language
 *
 * The text exists in German and English, chosen by the language of the mail client (see `suggestionFor`). German is
 * not a translation of the English: it is the same story told the way it would be told in German, because a
 * translated mail reads as a form letter and this one has to read as a person writing.
 *
 * German uses "Sie". The reader is whoever happened to send the user a message - possibly a stranger, possibly a
 * customer. An unnecessary "Sie" costs nothing, while an unwanted "du" to a stranger is exactly the wrong note, and
 * the user can change it in the draft either way.
 */

const MISSING_PARAGRAPHS_EN = url => [
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

const INVALID_PARAGRAPHS_EN = (url, reason) => [
  "Hi,",

  `your message came with an ESF stamp, but it didn't check out on my side${reason ? ` - my client said: ` +
    `${reason}` : ""}.`,

  "Your message itself arrived fine. Since we're both running this, it seemed worth telling you; usually it " +
  "turns out to be a difference in setup or versions.",

  url
];

/**
 * What the *interface* says about the suggestion, next to the button.
 *
 * These live here rather than in either client's popup because both clients show them, and a warning about
 * confirming your address is not something two codebases may word differently: the Outlook task pane and the
 * Thunderbird popup import the same sentences.
 *
 * The note says the thing the interface must not hide. A missing stamp looks identical on a colleague's mail and on
 * spam, so the honest framing is a caution, not an invitation: replying proves to a stranger that the mailbox is
 * real and read.
 */
export const SUGGESTION_LABELS = {
  missing: "Tell sender about ESF",
  invalid: "Tell sender it failed"
};

export const SUGGESTION_NOTE =
  "Opens a reply you can read and edit; nothing is sent for you. Only worth it for senders you know — a reply " +
  "tells a stranger the address is real.";

const MISSING_PARAGRAPHS_DE = url => [
  "Hallo,",

  "Ihre Nachricht ist gut angekommen - daran liegt es nicht.",

  "Etwas, das mich immer wieder beschäftigt: In meinem Briefkasten landen ein paar Prospekte pro Woche, in meinem " +
  "Postfach Hunderte. Der Unterschied ist, dass für die gedruckten jemand Porto bezahlen musste. E-Mail kostet den " +
  "Absender nichts, also hält nichts jemanden davon ab, eine Million zu verschicken.",

  "ESF bringt das Porto zurück. Kein Geld, sondern ein paar Sekunden Rechenzeit pro Nachricht. Diese eine an Sie " +
  "habe ich nicht gemerkt. Eine Million wären mehr als ein Monat Rechner unter Volllast, und das muss der " +
  "Werbetreibende bezahlen.",

  "Es ist kostenlos und Open Source, falls Ihre Nachrichten das auch tragen sollen:",

  url,

  "Eine Antwort ist nicht nötig."
];

const INVALID_PARAGRAPHS_DE = (url, reason) => [
  "Hallo,",

  `Ihre Nachricht kam mit einem ESF-Stempel, aber er ließ sich bei mir nicht prüfen${reason ? ` - mein Programm ` +
    `sagt: ${reason}` : ""}.`,

  "Die Nachricht selbst ist gut angekommen. Da wir beide ESF nutzen, schien mir der Hinweis sinnvoll; meistens " +
  "liegt es an unterschiedlichen Einstellungen oder Versionen.",

  url
];

/**
 * The suggestion text per language.
 *
 * Keyed by the bare language code, not by the full locale: German is German whether the client reports de, de-DE,
 * de-AT or de-CH. Anything not listed here gets English, which is the rule rather than a failure - a half
 * translated mail is worse than an English one.
 */
export const SUGGESTION_TEXTS = {
  en: {
    missing: {
      subject: "Why my inbox gets more junk than my letterbox",
      /** @param {string} url @returns {string} plain text body, one line per paragraph */
      body: url => MISSING_PARAGRAPHS_EN(url).join("\n\n")
    },
    invalid: {
      subject: "Your ESF stamp didn't check out here",
      /** @param {string} url @param {string} [reason] the verifier's own words for what failed */
      body: (url, reason) => INVALID_PARAGRAPHS_EN(url, reason).join("\n\n")
    }
  },
  de: {
    missing: {
      subject: "Warum in meinem Postfach mehr Werbung landet als im Briefkasten",
      /** @param {string} url @returns {string} plain text body, one line per paragraph */
      body: url => MISSING_PARAGRAPHS_DE(url).join("\n\n")
    },
    invalid: {
      subject: "Ihr ESF-Stempel ließ sich hier nicht prüfen",
      /** @param {string} url @param {string} [reason] the verifier's own words for what failed */
      body: (url, reason) => INVALID_PARAGRAPHS_DE(url, reason).join("\n\n")
    }
  }
};

/** The languages the product text exists in. Everything else is written in English, by design. */
export const TEXT_LANGUAGES = Object.keys(SUGGESTION_TEXTS);

/**
 * Reduces a client locale to a language the product text exists in - used for the suggestion and for the
 * footer, which must never disagree about what language a message is in.
 *
 * Takes whatever the platform reports - `de`, `de-DE`, `de_AT`, `DE`, or nothing at all - because the two clients
 * report it differently: Thunderbird's `browser.i18n.getUILanguage()` returns a BCP 47 tag, Office.js
 * `displayLanguage` an RFC 1766 one of the same shape, and a stored preference may be a bare code.
 *
 * @param {string} [locale]
 * @returns {string} a key of SUGGESTION_TEXTS
 */
export function textLanguage(locale) {
  const language = String(locale ?? "").trim().toLowerCase().split(/[-_]/)[0];
  return Object.hasOwn(SUGGESTION_TEXTS, language) ? language : "en";
}

/**
 * The suggestion text for a client locale.
 *
 * @param {string} [locale] as reported by the mail client
 * @returns {{missing: {subject: string, body: Function}, invalid: {subject: string, body: Function}}}
 */
export function suggestionFor(locale) {
  return SUGGESTION_TEXTS[textLanguage(locale)];
}

/** The English text, kept as a named export so call sites that do not know a locale keep working. */
export const SUGGESTION = SUGGESTION_TEXTS.en;
