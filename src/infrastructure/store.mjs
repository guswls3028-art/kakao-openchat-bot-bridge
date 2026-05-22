import fs from "node:fs";
import path from "node:path";

const DEFAULT_STATE = {
  notice: "",
  guides: [],
  dedupe: {},
  counts: {
    messages: 0,
    replies: 0,
    ignored: 0,
    forwardedQuestions: 0,
  },
};

const DEFAULT_EVENT_LOG_MAX_BYTES = 5 * 1024 * 1024;

export class JsonStore {
  constructor(dataDir, { eventLogMaxBytes = DEFAULT_EVENT_LOG_MAX_BYTES } = {}) {
    this.dataDir = dataDir;
    this.statePath = path.join(dataDir, "state.json");
    this.backupStatePath = path.join(dataDir, "state.json.bak");
    this.eventsPath = path.join(dataDir, "events.jsonl");
    this.eventLogMaxBytes = eventLogMaxBytes;
    fs.mkdirSync(dataDir, { recursive: true });
    this.state = this.#loadState();
  }

  #loadState() {
    for (const filePath of [this.statePath, this.backupStatePath]) {
      if (!fs.existsSync(filePath)) continue;
      try {
        const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
        return {
          ...structuredClone(DEFAULT_STATE),
          ...parsed,
          counts: { ...DEFAULT_STATE.counts, ...(parsed.counts || {}) },
          guides: Array.isArray(parsed.guides) ? parsed.guides : [],
          dedupe: parsed.dedupe && typeof parsed.dedupe === "object" ? parsed.dedupe : {},
        };
      } catch {
        // Try the backup before falling back to defaults.
      }
    }
    return structuredClone(DEFAULT_STATE);
  }

  #rotateEventsIfNeeded(nextBytes) {
    const maxBytes = Number(this.eventLogMaxBytes);
    if (!Number.isFinite(maxBytes) || maxBytes <= 0) return;
    let currentSize = 0;
    try {
      currentSize = fs.existsSync(this.eventsPath) ? fs.statSync(this.eventsPath).size : 0;
    } catch {
      return;
    }
    if (currentSize + nextBytes <= maxBytes) return;
    const rotatedPath = `${this.eventsPath}.1`;
    try {
      if (fs.existsSync(rotatedPath)) fs.rmSync(rotatedPath, { force: true });
      if (fs.existsSync(this.eventsPath)) fs.renameSync(this.eventsPath, rotatedPath);
    } catch {
      // If rotation fails, keep appending rather than losing events.
    }
  }

  save() {
    const body = `${JSON.stringify(this.state, null, 2)}\n`;
    const tempPath = `${this.statePath}.${process.pid}.tmp`;
    fs.writeFileSync(tempPath, body);
    try {
      if (fs.existsSync(this.statePath)) fs.copyFileSync(this.statePath, this.backupStatePath);
    } catch {
      // Backup is best-effort; atomic replace below is the integrity boundary.
    }
    fs.renameSync(tempPath, this.statePath);
  }

  appendEvent(event) {
    try {
      const line = `${JSON.stringify({ ...event, loggedAt: new Date().toISOString() })}\n`;
      this.#rotateEventsIfNeeded(Buffer.byteLength(line));
      fs.appendFileSync(this.eventsPath, line);
    } catch {
      // Logging must not break webhook processing.
    }
  }

  increment(key) {
    this.state.counts[key] = (this.state.counts[key] || 0) + 1;
    try {
      this.save();
    } catch {
      // Counters are operational hints, not part of command correctness.
    }
  }

  claimDedupe(key, ttlMs) {
    const now = Date.now();
    this.#pruneDedupe(now);
    const normalized = String(key || "").trim();
    if (!normalized) return true;
    const current = Number(this.state.dedupe[normalized] || 0);
    if (current > now) return false;
    this.state.dedupe[normalized] = now + Math.max(60_000, Number(ttlMs) || 60_000);
    try {
      this.save();
    } catch {
      // Keep the in-memory claim for this process even if persistence fails.
    }
    return true;
  }

  releaseDedupe(key) {
    const normalized = String(key || "").trim();
    if (!normalized || !this.state.dedupe[normalized]) return;
    delete this.state.dedupe[normalized];
    try {
      this.save();
    } catch {
      // Best-effort cleanup.
    }
  }

  #pruneDedupe(now = Date.now()) {
    const dedupe = this.state.dedupe;
    if (!dedupe || typeof dedupe !== "object") {
      this.state.dedupe = {};
      return;
    }
    for (const [key, expiresAt] of Object.entries(dedupe)) {
      if (Number(expiresAt) <= now) delete dedupe[key];
    }
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
