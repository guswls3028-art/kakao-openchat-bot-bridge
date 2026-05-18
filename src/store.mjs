import fs from "node:fs";
import path from "node:path";

const DEFAULT_STATE = {
  notice: "",
  guides: [],
  counts: {
    messages: 0,
    replies: 0,
    ignored: 0,
    forwardedQuestions: 0,
  },
};

export class JsonStore {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.statePath = path.join(dataDir, "state.json");
    this.eventsPath = path.join(dataDir, "events.jsonl");
    fs.mkdirSync(dataDir, { recursive: true });
    this.state = this.#loadState();
  }

  #loadState() {
    if (!fs.existsSync(this.statePath)) return structuredClone(DEFAULT_STATE);
    try {
      const parsed = JSON.parse(fs.readFileSync(this.statePath, "utf8"));
      return {
        ...structuredClone(DEFAULT_STATE),
        ...parsed,
        counts: { ...DEFAULT_STATE.counts, ...(parsed.counts || {}) },
        guides: Array.isArray(parsed.guides) ? parsed.guides : [],
      };
    } catch {
      return structuredClone(DEFAULT_STATE);
    }
  }

  save() {
    fs.writeFileSync(this.statePath, `${JSON.stringify(this.state, null, 2)}\n`);
  }

  appendEvent(event) {
    fs.appendFileSync(
      this.eventsPath,
      `${JSON.stringify({ ...event, loggedAt: new Date().toISOString() })}\n`,
    );
  }

  increment(key) {
    this.state.counts[key] = (this.state.counts[key] || 0) + 1;
    this.save();
  }

  setNotice(notice) {
    this.state.notice = String(notice || "").trim();
    this.save();
  }

  addGuide(label, url) {
    const guide = { label: String(label).trim(), url: String(url).trim() };
    this.state.guides = [
      guide,
      ...this.state.guides.filter((item) => item.label !== guide.label),
    ].slice(0, 30);
    this.save();
    return guide;
  }
}
