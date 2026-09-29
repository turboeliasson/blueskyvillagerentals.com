import { appendFileSync, readFileSync } from "node:fs";

export const EXPERIMENT_ID = "bsv-homeowners-2026-09";
export const EXPERIMENT_FILE = "/var/lib/bsv-lead/experiments.jsonl";

/* Enquiry forms per website version, in the order a visitor meets the fields.
   The honeypot is deliberately absent: never tracked, never reported. */
export const FORM_FIELDS = {
  "early-estimate-form": ["bedrooms", "area", "areaOther", "name", "contactBy", "email", "phone", "street"],
  "estimate-form": ["place", "bedrooms", "name", "email", "phone", "countryCode"],
  "hero-estimate-form": ["place", "name", "email", "countryCode", "phone"],
};
/* How much was typed, never what. A select reports "0" or "1-3": chosen or not. */
export const BUCKETS = ["0", "1-3", "4-10", "11-30", "31+"];
const FIELD_NAME = /^[a-zA-Z][a-zA-Z0-9_]{0,30}$/;

/* Which ad sent a browser here, as tagged on the ad link. Same patterns as attribution.js:
   the two sides must agree or a valid label would be dropped on arrival. */
const SOURCE_RULES = {
  utmSource: /^[a-zA-Z0-9_.-]{1,64}$/,
  utmMedium: /^[a-zA-Z0-9_.-]{1,64}$/,
  metaCampaignId: /^\d{5,30}$/,
  metaAdsetId: /^\d{5,30}$/,
  metaAdId: /^\d{5,30}$/,
};
/* The tuple a funnel row is grouped by. utmMedium is deliberately absent: it never varies
   within a campaign, so grouping on it would only split rows that belong together. */
const SOURCE_KEYS = ["utmSource", "metaCampaignId", "metaAdsetId", "metaAdId"];
const NO_SOURCE = "(none)";

export function validExperiment(value) {
  return value?.id === EXPERIMENT_ID && ["A", "B"].includes(value.variant) &&
    typeof value.visitorId === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.visitorId);
}

/* The ad label on a funnel row, cleaned to the five known keys. Values must be strings:
   an 18-digit Meta id read as a number would come back from JSON with the last digits
   changed. Returns a fresh object so nothing unvalidated can ride along into the log.
   An empty object is no label at all, so it returns null and the row is written bare. */
export function validSource(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const names = Object.keys(value);
  if (!names.length || names.length > 5) return null;
  if (!names.every(name => Object.hasOwn(SOURCE_RULES, name) &&
      typeof value[name] === "string" && SOURCE_RULES[name].test(value[name]))) return null;
  return Object.fromEntries(names.map(name => [name, value[name]]));
}

/* Which form produced an enquiry, so a lead can be matched to the beacon it ends. Only the
   tracked ids are accepted: the field arrives from the page, and nothing a visitor could type
   belongs in the funnel log. Every other form is untracked, so it has no beacon to match. */
export function validForm(value) {
  return Object.hasOwn(FORM_FIELDS, value) ? value : null;
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
      // Losing a visit is worse than losing its label, and every row written before
      // attribution existed has no label at all: an unreadable source drops itself, not the row.
      const source = validSource(event.source);
      if (source) event.source = source; else delete event.source;
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
      visitor = { variant: row.variant, events: new Set(), labelled: new Set() };
      visitors.set(row.visitorId, visitor);
    }
    // Progress rows repeat per form and must not enter the milestone dedupe set.
    if (visitor.variant !== row.variant || row.event === "progress") return;
    visitor.events.add(row.event);
    // Tracked apart from the milestone itself: a bare row still owes the ad funnel a labelled one.
    if (row.source) visitor.labelled.add(row.event);
  }
  function append(row) {
    appendFileSync(file, JSON.stringify(row) + "\n", { mode: 0o600 });
    remember(row);
  }
  readEvents(file).forEach(remember);
  return {
    record(experiment, event, source, form) {
      if (!validExperiment(experiment) || !["view", "start", "lead"].includes(event)) return false;
      const visitor = visitors.get(experiment.visitorId);
      if (visitor && visitor.variant !== experiment.variant) return false;
      /* Validated again here rather than trusted: the store is the last thing between a
         caller and the log, and this is what keeps fbclid out of aggregate funnel rows. */
      const label = validSource(source);
      // The form the enquiry came from, so an enquiry on one form leaves the other one abandoned.
      const formId = event === "lead" ? validForm(form) : null;
      // A successful submission also establishes exposure when a browser event was blocked.
      const events = event === "lead" ? ["view", "start", "lead"] : event === "start" ? ["view", "start"] : ["view"];
      for (const name of events) {
        const seen = visitors.get(experiment.visitorId);
        /* Milestones dedupe for the lifetime of a browser, but a milestone written bare still
           owes the per-ad funnel one labelled row: without it an ad click on a returning browser
           writes nothing and lands in (none). Both summaries count sets of visitorId, so the
           extra row inflates no count. The first label keeps the browser; later ads add nothing. */
        if (seen?.events.has(name) && (!label || seen.labelled.has(name))) continue;
        // A back-filled milestone belongs to the same ad click as the event that revealed it.
        append({
          experiment: experiment.id, variant: experiment.variant, visitorId: experiment.visitorId,
          event: name, at: new Date().toISOString(), ...(label ? { source: label } : {}),
          ...(name === "lead" && formId ? { form: formId } : {}),
        });
      }
      return true;
    },
    /* One row per form per page view. No dedupe and no back-fill: a beacon says how far
       someone got, it does not establish that they were exposed to the test. */
    recordProgress(experiment, progress, source) {
      if (!validExperiment(experiment) || !validProgress(progress)) return false;
      const visitor = visitors.get(experiment.visitorId);
      if (visitor && visitor.variant !== experiment.variant) return false;
      const label = validSource(source);
      append({
        experiment: experiment.id, variant: experiment.variant, visitorId: experiment.visitorId,
        event: "progress", at: new Date().toISOString(), ...(label ? { source: label } : {}),
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
  /* A saved enquiry outranks the beacon that preceded it. The beacon leaves on pagehide,
     which on the in-app browsers can fire before the submit handler sets the flag, so a
     browser we have a lead row for must never be reported as having walked away.
     Keyed per form, like the beacons below: a page carries two of them, and an enquiry on one
     says nothing about the other. Rows written before leads carried a form clear nothing. */
  const converted = new Set(events.filter(row => row.event === "lead" && row.form)
    .map(row => row.visitorId + " " + row.form));
  const wasSubmitted = row => row.progress.submitted || converted.has(row.visitorId + " " + row.progress.formId);
  return ["A", "B"].map(variant => {
    const latest = new Map();
    for (const row of events) {
      if (row.variant !== variant || row.event !== "progress") continue;
      const key = row.visitorId + " " + row.progress.formId;
      const previous = latest.get(key);
      if (!previous || previous.at <= row.at) latest.set(key, row);
    }
    const beacons = [...latest.values()];
    const abandoned = beacons.filter(row => !wasSubmitted(row));
    const forms = {};
    for (const row of beacons) {
      const { formId } = row.progress;
      const form = forms[formId] ??= {
        formId, beacons: 0, submitted: 0, abandoned: 0,
        fields: Object.fromEntries(FORM_FIELDS[formId].map(name => [name, { filled: 0, abandonedHere: 0 }])),
      };
      form.beacons++;
      if (wasSubmitted(row)) form.submitted++; else form.abandoned++;
      for (const [name, value] of Object.entries(row.progress.fields)) {
        if (form.fields[name] && value !== "0") form.fields[name].filled++;
      }
      const last = row.progress.lastField;
      if (!wasSubmitted(row) && last && form.fields[last]) form.fields[last].abandonedHere++;
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

/* The funnel split by the ad that produced it, both versions together: a campaign is judged
   on the clicks it bought, not on which page half of them happened to land on. */
export function summarizeSources(events) {
  /* A browser belongs to exactly one bucket, fixed by the first row that carried a label.
     Later rows arrive unlabelled whenever someone returns by typing the address, and
     relabelling on the way through would count one browser under two ads. */
  const bucketOf = new Map(), labels = new Map();
  for (const row of events) {
    if (!row.source || bucketOf.has(row.visitorId)) continue;
    const key = SOURCE_KEYS.map(name => row.source[name] ?? "").join("/");
    bucketOf.set(row.visitorId, key);
    if (!labels.has(key)) labels.set(key, row.source);
  }
  const counts = new Map();
  for (const row of events) {
    if (!["view", "start", "lead"].includes(row.event)) continue;
    const key = bucketOf.get(row.visitorId) ?? NO_SOURCE;
    const tally = counts.get(key) ?? counts.set(key, { view: new Set(), start: new Set(), lead: new Set() }).get(key);
    tally[row.event].add(row.visitorId);
  }
  const percent = (part, whole) => whole ? +(part / whole * 100).toFixed(2) : 0;
  return [...counts].map(([key, tally]) => {
    const label = labels.get(key) || {};
    const views = tally.view.size, starts = tally.start.size, leads = tally.lead.size;
    return {
      key, ...Object.fromEntries(SOURCE_KEYS.map(name => [name, label[name] ?? null])),
      views, starts, leads, startPercent: percent(starts, views), conversionPercent: percent(leads, views),
    };
  }).sort((a, b) => (a.key === NO_SOURCE) - (b.key === NO_SOURCE) || b.views - a.views || a.key.localeCompare(b.key));
}

export function summarizeEvents(events) {
  const variants = ["A", "B"].map(variant => {
    const unique = event => new Set(events.filter(row => row.variant === variant && row.event === event).map(row => row.visitorId)).size;
    const visitors = unique("view"), started = unique("start"), converted = unique("lead");
    return { variant, visitors, started, converted, conversionPercent: visitors ? +(converted / visitors * 100).toFixed(2) : 0 };
  });
  // A beacon can outrun its own start event, so exposure still dates from a milestone.
  const firstEvent = events.find(row => row.event !== "progress")?.at || null;
  return {
    experiment: EXPERIMENT_ID, firstEvent, variants,
    progress: summarizeProgress(events), bySource: summarizeSources(events),
  };
}
