import { readEvents, summarizeEvents } from "./experiments.mjs";

const result = summarizeEvents(readEvents());
if (process.argv.includes("--json")) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`Experiment: ${result.experiment}`);
  console.log(`First event: ${result.firstEvent || "No visitors recorded yet"}`);
  console.table(result.variants);
  console.log("A = original website; B = village redesign. Conversion = unique browsers with a saved enquiry / unique exposed browsers.");
  console.log("Review links and known bots are excluded. Counts do not establish a winner on their own.");

  const measured = result.progress.filter(variant => variant.beacons);
  if (!measured.length) {
    console.log("\nNo form-progress beacons recorded yet.");
  } else for (const variant of measured) {
    console.log(`\nForm progress, version ${variant.variant}`);
    console.log(`  beacons ${variant.beacons} | submitted ${variant.submitted} | abandoned ${variant.abandoned}` +
      (variant.medianAbandonedSeconds === null ? "" : ` | median ${variant.medianAbandonedSeconds}s before leaving`));
    for (const form of variant.forms) {
      console.log(`  #${form.formId} (${form.submitted} submitted, ${form.abandoned} abandoned)`);
      console.table(Object.entries(form.fields).map(([field, counts]) => ({
        field, filled: counts.filled, "left on this field": counts.abandonedHere,
      })));
    }
    const depth = Object.entries(variant.depthHistogram).sort((a, b) => a[0] - b[0]);
    if (depth.length) console.log("  fields filled before abandoning: " + depth.map(([n, c]) => `${n}->${c}`).join(", "));
  }
  console.log("\nCharacter counts are bucketed and no field values are recorded. The honeypot is never tracked.");
}
