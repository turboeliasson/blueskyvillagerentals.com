import { appendFileSync, readFileSync } from "node:fs";

export const EXPERIMENT_ID = "bsv-homeowners-2026-09";
export const EXPERIMENT_FILE = "/var/lib/bsv-lead/experiments.jsonl";

export function validExperiment(value) {
  return value?.id === EXPERIMENT_ID && ["A", "B"].includes(value.variant) &&
    typeof value.visitorId === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.visitorId);
}

export function readEvents(file = EXPERIMENT_FILE) {
  let text;
  try { text = readFileSync(file, "utf8"); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
  return text.split("\n").filter(Boolean).flatMap(line => {
    try {
      const event = JSON.parse(line);
      return validExperiment({ ...event, id: event.experiment }) &&
        ["view", "start", "lead"].includes(event.event) ? [event] : [];
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
    if (visitor.variant === row.variant) visitor.events.add(row.event);
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
        const row = {
          experiment: experiment.id, variant: experiment.variant, visitorId: experiment.visitorId,
          event: name, at: new Date().toISOString(),
        };
        appendFileSync(file, JSON.stringify(row) + "\n", { mode: 0o600 });
        remember(row);
      }
      return true;
    },
  };
}

export function summarizeEvents(events) {
  const variants = ["A", "B"].map(variant => {
    const unique = event => new Set(events.filter(row => row.variant === variant && row.event === event).map(row => row.visitorId)).size;
    const visitors = unique("view"), started = unique("start"), converted = unique("lead");
    return { variant, visitors, started, converted, conversionPercent: visitors ? +(converted / visitors * 100).toFixed(2) : 0 };
  });
  return { experiment: EXPERIMENT_ID, firstEvent: events[0]?.at || null, variants };
}
