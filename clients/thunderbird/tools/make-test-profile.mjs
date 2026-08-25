/**
 * Builds a throwaway Thunderbird profile for manual testing, seeded with messages that cover every ESF verification
 * outcome. It never touches an existing profile.
 *
 * Usage: npm run profile -- <profileDir>
 *
 * Afterwards:  thunderbird.exe -no-remote -profile <profileDir>
 *
 * Note: a pre-written mbox is only indexed once the folder is opened in the UI, so click the Inbox once after the
 * first start.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { serializeStamp, serializeStampList } from "../src/protocol/parser.js";
import { generateStamp } from "../src/protocol/stamp.js";

const profileDir = process.argv[2];
if (!profileDir) {
  console.error("usage: node tools/make-test-profile.mjs <profileDir>");
  process.exit(1);
}

const ME = "esf-test@example.com";
const SENDER = "sender@example.org";
const DAY = 24 * 60 * 60 * 1000;
const DIFFICULTY = 20;

const PREFS = `// Throwaway profile for ESF add-on testing.
user_pref("xpinstall.signatures.required", false);
user_pref("extensions.autoDisableScopes", 0);
user_pref("app.update.auto", false);
user_pref("app.update.enabled", false);
user_pref("datareporting.healthreport.uploadEnabled", false);
user_pref("datareporting.policy.dataSubmissionEnabled", false);
user_pref("toolkit.telemetry.enabled", false);
user_pref("mail.provider.suppress_dialog_on_startup", true);
user_pref("mail.shell.checkDefaultClient", false);
user_pref("mailnews.start_page.enabled", false);
user_pref("mail.spotlight.firstRunDone", true);
user_pref("browser.dom.window.dump.enabled", true);
user_pref("javascript.options.showInConsole", true);
// Runs the extension in the parent process, so console output lands on stdout for headless test runs.
user_pref("extensions.webextensions.remote", false);

// A Local Folders only account, so compose and message display work without a server.
user_pref("mail.accountmanager.accounts", "account1");
user_pref("mail.accountmanager.defaultaccount", "account1");
user_pref("mail.accountmanager.localfoldersserver", "server1");
user_pref("mail.account.account1.server", "server1");
user_pref("mail.account.account1.identities", "id1");
user_pref("mail.server.server1.type", "none");
user_pref("mail.server.server1.hostname", "Local Folders");
user_pref("mail.server.server1.name", "Local Folders");
user_pref("mail.server.server1.userName", "nobody");
user_pref("mail.server.server1.directory-rel", "[ProfD]Mail/Local Folders");
user_pref("mail.identity.id1.useremail", "${ME}");
user_pref("mail.identity.id1.fullName", "ESF Test");
user_pref("mail.identity.id1.valid", true);
`;

async function stamp({ recipient = ME, difficulty = DIFFICULTY, ageMs = 60_000, patch = {} } = {}) {
  const { stamp: generated } = await generateStamp({
    from: SENDER,
    recipient,
    messageId: `${crypto.randomUUID()}@esf.invalid`,
    difficulty,
    now: Date.now() - ageMs
  });
  return { ...generated, ...patch };
}

async function header(options) {
  return serializeStamp(await stamp(options));
}

/** Mozilla mbox uses the asctime form for the separator line; an RFC 2822 date is not parsed. */
function mboxSeparator(date) {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const pad = value => String(value).padStart(2, "0");
  return `From - ${days[date.getDay()]} ${months[date.getMonth()]} ${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())} ${date.getFullYear()}`;
}

function message({ subject, headers = [], body }) {
  return [
    mboxSeparator(new Date()),
    `Message-ID: <${crypto.randomUUID()}@test.esf.invalid>`,
    `Date: ${new Date().toUTCString()}`,
    `From: Sender <${SENDER}>`,
    `To: ESF Test <${ME}>`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    ...headers.map(value => `X-ESF-Stamp: ${value}`),
    "",
    body,
    ""
  ].join("\r\n");
}

const cases = [
  {
    subject: "01 valid stamp (expect: GREEN)",
    headers: [await header()],
    body: "A valid ESF stamp bound to your address."
  },
  {
    subject: "02 stamp list for three recipients (expect: GREEN)",
    headers: [serializeStampList([
      await stamp({ recipient: "other-one@example.com" }),
      await stamp(),
      await stamp({ recipient: "other-two@example.com" })
    ])],
    body: "The wire form for a multi-recipient message: one field, one stamp per recipient."
  },
  {
    subject: "03 repeated header fields (expect: GREEN)",
    headers: [await header({ recipient: "other-three@example.com" }), await header()],
    body: "Another client may emit one field per recipient; that must verify too."
  },
  {
    subject: "04 weak stamp, 8 bits (expect: YELLOW, below policy)",
    headers: [await header({ difficulty: 8 })],
    body: "Real work, but below the receiver's minimum difficulty."
  },
  {
    subject: "05 argon2id profile (expect: YELLOW, unsupported profile)",
    headers: [serializeStamp({ ...await stamp(), algorithm: "argon2id",
      profileParams: { mem: "16384", iter: "1", lanes: "1" } })],
    body: "An ESF v1 profile this client does not implement. Never invalid, never executed."
  },
  {
    subject: "06 tampered nonce (expect: RED, insufficient work)",
    headers: [await header({ patch: { nonce: "deadbeef" } })],
    body: "The nonce was replaced after the stamp was minted."
  },
  {
    subject: "07 overclaimed difficulty (expect: RED, insufficient work)",
    headers: [await header({ patch: { difficulty: 26 } })],
    body: "A 20 bit stamp claiming 26 bits."
  },
  {
    subject: "08 absurd difficulty (expect: RED, out of range)",
    headers: [await header({ patch: { difficulty: 250 } })],
    body: "Declares d=250. Verification must refuse this without doing any work."
  },
  {
    subject: "09 stale stamp, 10 days old (expect: RED, stale)",
    headers: [await header({ ageMs: 10 * DAY })],
    body: "Valid work, but outside the freshness window."
  },
  {
    subject: "10 future stamp (expect: RED, future timestamp)",
    headers: [await header({ ageMs: -6 * 60 * 60 * 1000 })],
    body: "Timestamped six hours ahead."
  },
  {
    subject: "11 stamp for somebody else (expect: RED, wrong recipient)",
    headers: [await header({ recipient: "nobody@example.com" })],
    body: "A perfectly valid stamp - for a different recipient."
  },
  {
    subject: "12 malformed field (expect: RED, malformed)",
    headers: ["v=1; alg=sha256; d=oops; t=nope; sid=x; rid=y; mid=z; salt=zz; nonce=0x1"],
    body: "Garbage must fail cleanly, never throw."
  },
  {
    subject: "13 no stamp at all (expect: RED, missing - and not presented as abuse)",
    headers: [],
    body: "The normal case for virtually all mail today."
  }
];

await mkdir(join(profileDir, "Mail", "Local Folders"), { recursive: true });
await mkdir(join(profileDir, "extensions"), { recursive: true });
await writeFile(join(profileDir, "user.js"), PREFS, "utf8");
await writeFile(join(profileDir, "Mail", "Local Folders", "Inbox"),
  cases.map(entry => message(entry)).join("\r\n"), "binary");

console.log(`profile:   ${profileDir}`);
console.log(`identity:  ${ME}`);
console.log(`messages:  ${cases.length} in Local Folders/Inbox`);
