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
}
