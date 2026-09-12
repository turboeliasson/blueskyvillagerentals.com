import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../attribution.js", import.meta.url), "utf8");
function read(search) {
  const window = { location: { search } };
  vm.runInNewContext(source, { window, URLSearchParams });
  return JSON.parse(JSON.stringify(window.BSVAttribution.leadData()));
}

test("keeps only source, medium and stable Meta IDs from a paid landing URL", () => {
  assert.deepEqual(read("?utm_source=ig&utm_medium=paid_social&utm_campaign=120123456789&utm_term=120987654321&utm_content=120111222333&email=private%40example.com&fbclid=ignored"), {
    attribution: { utmSource: "ig", utmMedium: "paid_social", metaCampaignId: "120123456789", metaAdsetId: "120987654321", metaAdId: "120111222333" }
  });
});

test("organic, unexpanded macros and arbitrary query values do not create attribution", () => {
  for (const search of ["", "?utm_campaign={{campaign.id}}&utm_term=homeowner&utm_content=private%40example.com", "?utm_source=https://example.com/private&utm_medium=" + "a".repeat(65), "?utm_source=ig%0A&utm_content=120123456789%0A"]) {
    assert.deepEqual(read(search), {});
  }
});
