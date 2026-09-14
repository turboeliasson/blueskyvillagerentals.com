import { appendFileSync, readFileSync } from "node:fs";

export const EXPERIMENT_ID = "bsv-homeowners-2026-09";
export const EXPERIMENT_FILE = "/var/lib/bsv-lead/experiments.jsonl";

/* Enquiry forms per website version, in the order a visitor meets the fields.
   The honeypot is deliberately absent: never tracked, never reported. */
export const FORM_FIELDS = {
  "early-estimate-form": ["place", "name", "phone", "email", "bedrooms"],
  "estimate-form": ["place", "bedrooms", "name", "email", "phone", "countryCode"],
  "hero-estimate-form": ["place", "name", "email", "countryCode", "phone"],
};
/* How much was typed, never what. A select reports "0" or "1-3": chosen or not. */
export const BUCKETS = ["0", "1-3", "4-10", "11-30", "31+"];
const FIELD_NAME = /^[a-zA-Z][a-zA-Z0-9_]{0,30}$/;

export function validExperiment(value) {
  return value?.id === EXPERIMENT_ID && ["A", "B"].includes(value.variant) &&
    typeof value.visitorId === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.visitorId);
}

/* Depth and volume of an abandoned or completed form. Anything unexpected rejects the
   whole event: a partially trusted payload is worse than no measurement at all. */
export function validProgress(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (!Object.hasOwn(FORM_FIELDS, value.formId)) return false;
  if (typeof value.submitted !== "boolean") return false;
  if (value.lastField !== null && !(typeof value.lastField === "string" &&
      FIELD_NAME.test(value.lastField) && value.lastField !== "website")) return false;
  if ([value.filledCount, value.requiredRemaining].some(n => !Number.isInteger(n) || n < 0 || n > 12)) return false;
  if (!Number.isInteger(value.secondsSinceStart) || value.secondsSinceStart < 0 ||
      value.secondsSinceStart > 3600) return false;
  const fields = value.fields;
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) return false;
  const names = Object.keys(fields);
  if (names.length > 12) return false;
  return names.every(name => name !== "website" && FIELD_NAME.test(name) && BUCKETS.includes(fields[name]));
}

export function readEvents(file = EXPERIMENT_FILE) {
  let text;
  try { text = readFileSync(file, "utf8"); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
  return text.split("\n").filter(Boolean).flatMap(line => {
    try {
      const event = JSON.parse(line);
      if (!validExperiment({ ...event, id: event.experiment })) return [];
      if (event.event === "progress") return validProgress(event.progress) ? [event] : [];
      return ["view", "start", "lead"].includes(event.event) ? [event] : [];
    } catch { return []; }
  });
}

export function createExperimentStore(file = EXPERIMENT_FILE) {
  const visitors = new Map();
  function remember(row) {
    let visitor = visitors.get(row.visitorId);
    if (!visitor) {
      visitor = { variant: row.variant, events: new Set() };
      visitors.set(row.visitorId, visitor);
    }
    // Progress rows repeat per form and must not enter the milestone dedupe set.
    if (visitor.variant === row.variant && row.event !== "progress") visitor.events.add(row.event);
  }
  function append(row) {
    appendFileSync(file, JSON.stringify(row) + "\n", { mode: 0o600 });
    remember(row);
  }
  readEvents(file).forEach(remember);
  return {
    record(experiment, event) {
      if (!validExperiment(experiment) || !["view", "start", "lead"].includes(event)) return false;
      const visitor = visitors.get(experiment.visitorId);
      if (visitor && visitor.variant !== experiment.variant) return false;
      // A successful submission also establishes exposure when a browser event was blocked.
      const events = event === "lead" ? ["view", "start", "lead"] : event === "start" ? ["view", "start"] : ["view"];
      for (const name of events) {
        if (visitors.get(experiment.visitorId)?.events.has(name)) continue;
        append({
          experiment: experiment.id, variant: experiment.variant, visitorId: experiment.visitorId,
          event: name, at: new Date().toISOString(),
        });
      }
      return true;
    },
    /* One row per form per page view. No dedupe and no back-fill: a beacon says how far
       someone got, it does not establish that they were exposed to the test. */
    recordProgress(experiment, progress) {
      if (!validExperiment(experiment) || !validProgress(progress)) return false;
      const visitor = visitors.get(experiment.visitorId);
      if (visitor && visitor.variant !== experiment.variant) return false;
      append({
        experiment: experiment.id, variant: experiment.variant, visitorId: experiment.visitorId,
        event: "progress", at: new Date().toISOString(),
        progress: {
          formId: progress.formId, lastField: progress.lastField,
          filledCount: progress.filledCount, requiredRemaining: progress.requiredRemaining,
          secondsSinceStart: progress.secondsSinceStart, submitted: progress.submitted,
          fields: { ...progress.fields },
        },
      });
      return true;
    },
  };
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

/* How far abandoned sessions got, per version. Keeps one beacon per visitor and form:
   the last one wins, so a reload does not count as a second attempt. */
export function summarizeProgress(events) {
  return ["A", "B"].map(variant => {
    const latest = new Map();
    for (const row of events) {
      if (row.variant !== variant || row.event !== "progress") continue;
      const key = row.visitorId + " " + row.progress.formId;
      const previous = latest.get(key);
      if (!previous || previous.at <= row.at) latest.set(key, row);
    }
    const beacons = [...latest.values()];
    const abandoned = beacons.filter(row => !row.progress.submitted);
    const forms = {};
    for (const row of beacons) {
      const { formId } = row.progress;
      const form = forms[formId] ??= {
        formId, beacons: 0, submitted: 0, abandoned: 0,
        fields: Object.fromEntries(FORM_FIELDS[formId].map(name => [name, { filled: 0, abandonedHere: 0 }])),
      };
      form.beacons++;
      if (row.progress.submitted) form.submitted++; else form.abandoned++;
      for (const [name, value] of Object.entries(row.progress.fields)) {
        if (form.fields[name] && value !== "0") form.fields[name].filled++;
      }
      const last = row.progress.lastField;
      if (!row.progress.submitted && last && form.fields[last]) form.fields[last].abandonedHere++;
    }
    const depthHistogram = {};
    for (const row of abandoned) {
      depthHistogram[row.progress.filledCount] = (depthHistogram[row.progress.filledCount] || 0) + 1;
    }
    return {
      variant, beacons: beacons.length, submitted: beacons.length - abandoned.length,
      abandoned: abandoned.length,
      medianAbandonedSeconds: median(abandoned.map(row => row.progress.secondsSinceStart)),
      depthHistogram, forms: Object.values(forms),
    };
  });
}

export function summarizeEvents(events) {
  const variants = ["A", "B"].map(variant => {
    const unique = event => new Set(events.filter(row => row.variant === variant && row.event === event).map(row => row.visitorId)).size;
    const visitors = unique("view"), started = unique("start"), converted = unique("lead");
    return { variant, visitors, started, converted, conversionPercent: visitors ? +(converted / visitors * 100).toFixed(2) : 0 };
  });
  // A beacon can outrun its own start event, so exposure still dates from a milestone.
  const firstEvent = events.find(row => row.event !== "progress")?.at || null;
  return { experiment: EXPERIMENT_ID, firstEvent, variants, progress: summarizeProgress(events) };
}
