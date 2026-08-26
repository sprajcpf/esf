/**
 * The Outlook footer adapter. The text itself is tested in the Thunderbird suite; what matters here is the Office.js
 * behaviour: the right coercion type, graceful failure, and never appending where the platform cannot do it.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { appendFooter, canAppendFooter } from "../src/compose/footer.js";
import { FOOTER_HTML, FOOTER_PLAIN } from "../../thunderbird/src/utils/footer.js";

/** Minimal Office.js stand-in, matching the shapes the adapter actually touches. */
function stubOffice({ supported = true, bodyType = "text", appendSucceeds = true, hasAppend = true } = {}) {
  const calls = [];
  globalThis.Office = {
    CoercionType: { Html: "html", Text: "text" },
    AsyncResultStatus: { Succeeded: "succeeded", Failed: "failed" },
    context: { requirements: { isSetSupported: (name, version) => supported && name === "Mailbox" } }
  };
  const body = {
    getTypeAsync: callback => callback({ status: "succeeded", value: bodyType }),
    appendOnSendAsync: (text, options, callback) => {
      calls.push({ text, options });
      callback({ status: appendSucceeds ? "succeeded" : "failed" });
    }
  };
  if (!hasAppend) {
    delete body.appendOnSendAsync;
  }
  return { item: { body }, calls };
}

test("appends the plain text footer in a text body", async () => {
  const { item, calls } = stubOffice({ bodyType: "text" });
  assert.equal(await appendFooter(item), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].text, FOOTER_PLAIN);
  assert.equal(calls[0].options.coercionType, "text");
});

test("appends the HTML footer in an HTML body", async () => {
  const { item, calls } = stubOffice({ bodyType: "html" });
  assert.equal(await appendFooter(item), true);
  assert.equal(calls[0].text, FOOTER_HTML);
  assert.equal(calls[0].options.coercionType, "html");
});

test("does nothing where the requirement set is missing", async () => {
  const { item, calls } = stubOffice({ supported: false });
  assert.equal(canAppendFooter(), false);
  assert.equal(await appendFooter(item), false);
  assert.equal(calls.length, 0, "a client that cannot append must not be asked to");
});

test("does nothing where the API itself is absent", async () => {
  const { item } = stubOffice({ hasAppend: false });
  assert.equal(await appendFooter(item), false);
});

test("a failed append is reported, not thrown - the stamp still went out", async () => {
  const { item } = stubOffice({ appendSucceeds: false });
  assert.equal(await appendFooter(item), false);
});

test("a throwing API is contained", async () => {
  const { item } = stubOffice();
  item.body.appendOnSendAsync = () => {
    throw new Error("Office exploded");
  };
  assert.equal(await appendFooter(item), false);
});

test("no item, no crash", async () => {
  stubOffice();
  assert.equal(await appendFooter(undefined), false);
  assert.equal(await appendFooter({}), false);
});
