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

test('source tags survive internal navigation without copying personal queries or tagging external links', () => {
  const window = { location: { search: '?utm_source=chatgpt.com&utm_content=120123456789&email=private@example.com', href: 'https://blueskyvillagerentals.com/locations/?utm_source=chatgpt.com', origin: 'https://blueskyvillagerentals.com' } };
  const link = href => ({ href: new URL(href, window.location.href).href, getAttribute: () => href });
  const links = [link('/locations/savannah/'), link('https://example.com/'), link('#estimate'), link('/homeowners/rental-estimate/?utm_source=existing')];
  vm.runInNewContext(source, { window, URL, URLSearchParams, document: { readyState: 'complete', querySelectorAll: () => links } });
  assert.equal(links[0].href, 'https://blueskyvillagerentals.com/locations/savannah/?utm_source=chatgpt.com&utm_content=120123456789');
  assert.equal(links[1].href, 'https://example.com/');
  assert.ok(!links[2].href.includes('utm_content'));
  assert.ok(links[3].href.includes('utm_source=existing'));
});
