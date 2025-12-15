// ============================================
// VerifyAI — Modern Fact-Checking Interface
// ============================================

const els = {
  url: document.getElementById("url"),
  run: document.getElementById("run"),
  forceRun: document.getElementById("forceRun"),
  newAnalysis: document.getElementById("newAnalysis"),
  logoLink: document.getElementById("logoLink"),

  langDropdown: document.getElementById("langDropdown"),
  langButton: document.getElementById("langButton"),
  langMenu: document.getElementById("langMenu"),
  langSearch: document.getElementById("langSearch"),
  langList: document.getElementById("langList"),
  langLabel: document.getElementById("langLabel"),

  historyToggle: document.getElementById("historyToggle"),
  historyCard: document.getElementById("historyCard"),
  historyRefresh: document.getElementById("historyRefresh"),
  historyList: document.getElementById("historyList"),

  statusCard: document.getElementById("statusCard"),
  statusText: document.getElementById("statusText"),
  progressPill: document.getElementById("progressPill"),
  progressBar: document.getElementById("progressBar"),
  infoBox: document.getElementById("infoBox"),
  errorBox: document.getElementById("errorBox"),
  resultCard: document.getElementById("resultCard"),
  scoreCircle: document.getElementById("scoreCircle"),
  scorePct: document.getElementById("scorePct"),
  verdictText: document.getElementById("verdictText"),
  generatedAt: document.getElementById("generatedAt"),
  rerunBtn: document.getElementById("rerunBtn"),
  reportSummary: document.getElementById("reportSummary"),
  whatsRight: document.getElementById("whatsRight"),
  whatsWrong: document.getElementById("whatsWrong"),
  dangerList: document.getElementById("dangerList"),
  dangerSection: document.getElementById("dangerSection"),
  sourcesList: document.getElementById("sourcesList"),
  claimsList: document.getElementById("claimsList"),
  transcript: document.getElementById("transcript"),

  tabClaims: document.getElementById("tabClaims"),
  tabSources: document.getElementById("tabSources"),
  tabTranscript: document.getElementById("tabTranscript"),
  panelClaims: document.getElementById("panelClaims"),
  panelSources: document.getElementById("panelSources"),
  panelTranscript: document.getElementById("panelTranscript"),
};

// Status step elements
const statusSteps = document.querySelectorAll('.step');

const LANGUAGES_PINNED = [
  { code: "ar", name: "Arabic" },
  { code: "en", name: "English" },
  { code: "fr", name: "French" },
];

const LANGUAGES_OTHERS = [
  { code: "bn", name: "Bengali" },
  { code: "zh", name: "Chinese" },
  { code: "cs", name: "Czech" },
  { code: "da", name: "Danish" },
  { code: "nl", name: "Dutch" },
  { code: "fi", name: "Finnish" },
  { code: "de", name: "German" },
  { code: "el", name: "Greek" },
  { code: "he", name: "Hebrew" },
  { code: "hi", name: "Hindi" },
  { code: "hu", name: "Hungarian" },
  { code: "id", name: "Indonesian" },
  { code: "it", name: "Italian" },
  { code: "ja", name: "Japanese" },
  { code: "ko", name: "Korean" },
  { code: "ms", name: "Malay" },
  { code: "no", name: "Norwegian" },
  { code: "fa", name: "Persian" },
  { code: "pl", name: "Polish" },
  { code: "pt", name: "Portuguese" },
  { code: "ro", name: "Romanian" },
  { code: "ru", name: "Russian" },
  { code: "es", name: "Spanish" },
  { code: "sw", name: "Swahili" },
  { code: "sv", name: "Swedish" },
  { code: "tl", name: "Filipino (Tagalog)" },
  { code: "th", name: "Thai" },
  { code: "tr", name: "Turkish" },
  { code: "uk", name: "Ukrainian" },
  { code: "ur", name: "Urdu" },
  { code: "vi", name: "Vietnamese" },
].sort((a, b) => a.name.localeCompare(b.name));

const LANGUAGES = [...LANGUAGES_PINNED, ...LANGUAGES_OTHERS];

let selectedLanguage = LANGUAGES[0];
let lastSubmittedUrl = "";
let currentReportLanguage = null;
let activeDetailsTab = "claims";

const RTL_LANGS = new Set(["ar", "fa", "he", "ur"]);

// ============================================
// Utility Functions
// ============================================

function setHidden(el, hidden) {
  if (!el) return;
  if (hidden) el.classList.add("hidden");
  else el.classList.remove("hidden");
}

function setText(el, text) {
  if (!el) return;
  el.textContent = text ?? "";
}

function formatTranscript(text) {
  const raw = String(text ?? "");
  if (!raw) return "";
  const withoutPartHeaders = raw.replace(/^\s*\[?\s*part\s+\d+\s*\/\s*\d+\s*\]?\s*$/gim, "");
  return withoutPartHeaders.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function isRtlLanguage(code) {
  return RTL_LANGS.has(String(code || "").toLowerCase());
}

function applyOutputDirection() {
  const lang = String(currentReportLanguage || selectedLanguage?.code || "en").toLowerCase();
  const dir = isRtlLanguage(lang) ? "rtl" : "ltr";

  const outputEls = [els.reportSummary, els.whatsRight, els.whatsWrong, els.dangerList, els.claimsList];
  for (const el of outputEls) {
    if (!el) continue;
    el.setAttribute("dir", dir);
    el.setAttribute("lang", lang);
  }

  if (els.sourcesList) els.sourcesList.setAttribute("dir", "auto");
  if (els.transcript) els.transcript.setAttribute("dir", "auto");
}

// ============================================
// Tabs
// ============================================

function setDetailsTab(name) {
  activeDetailsTab = name;

  const tabs = [
    { name: "claims", tab: els.tabClaims, panel: els.panelClaims },
    { name: "sources", tab: els.tabSources, panel: els.panelSources },
    { name: "transcript", tab: els.tabTranscript, panel: els.panelTranscript },
  ];

  for (const t of tabs) {
    const isActive = t.name === name;
    if (t.tab) {
      t.tab.classList.toggle("tab-active", isActive);
      t.tab.setAttribute("aria-selected", isActive ? "true" : "false");
      t.tab.tabIndex = isActive ? 0 : -1;
    }
    if (t.panel) setHidden(t.panel, !isActive);
  }
}

// ============================================
// Progress & Status
// ============================================

function setProgress(pct) {
  const progressValue = els.progressPill?.querySelector('.progress-value');
  if (progressValue) progressValue.textContent = pct;
  if (els.progressBar) {
    els.progressBar.style.width = `${pct}%`;
    // Update the glow effect
    const wrapper = els.progressBar.parentElement;
    if (wrapper) {
      wrapper.style.setProperty('--progress', `${pct}%`);
    }
  }
  
  // Update status steps based on progress
  updateStatusSteps(pct);
}

function updateStatusSteps(pct) {
  const steps = ['download', 'transcribe', 'analyze', 'report'];
  const thresholds = [0, 25, 50, 75];
  
  statusSteps.forEach((step, index) => {
    const stepName = step.dataset.step;
    const stepIndex = steps.indexOf(stepName);
    
    step.classList.remove('active', 'completed');
    
    if (pct >= 100) {
      step.classList.add('completed');
    } else if (pct >= thresholds[stepIndex] && pct < (thresholds[stepIndex + 1] || 100)) {
      step.classList.add('active');
    } else if (pct > thresholds[stepIndex]) {
      step.classList.add('completed');
    }
  });
}

function setList(ul, items) {
  if (!ul) return;
  ul.innerHTML = "";
  for (const item of items || []) {
    const li = document.createElement("li");
    li.textContent = item;
    ul.appendChild(li);
  }
}

function setDangerList(ul, items) {
  if (!ul) return;
  ul.innerHTML = "";
  
  const dangers = items || [];
  
  // Hide danger section if empty
  if (els.dangerSection) {
    setHidden(els.dangerSection, dangers.length === 0);
  }
  
  // Sort by severity (highest first)
  const sortedDangers = [...dangers].sort((a, b) => (b.severity || 0) - (a.severity || 0));
  
  for (const d of sortedDangers) {
    const severity = typeof d.severity === "number" && Number.isFinite(d.severity) 
      ? Math.max(1, Math.min(5, d.severity)) 
      : 3;
    
    const li = document.createElement("li");
    li.className = `danger-item severity-${severity}`;
    
    // Icon based on severity
    const iconSvg = severity >= 4 
      ? `<svg class="danger-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
           <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
           <line x1="12" y1="9" x2="12" y2="13"/>
           <line x1="12" y1="17" x2="12.01" y2="17"/>
         </svg>`
      : severity >= 2
      ? `<svg class="danger-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
           <circle cx="12" cy="12" r="10"/>
           <line x1="12" y1="8" x2="12" y2="12"/>
           <line x1="12" y1="16" x2="12.01" y2="16"/>
         </svg>`
      : `<svg class="danger-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
           <circle cx="12" cy="12" r="10"/>
           <line x1="12" y1="16" x2="12" y2="12"/>
           <line x1="12" y1="8" x2="12.01" y2="8"/>
         </svg>`;
    
    const content = document.createElement("div");
    content.className = "danger-content";
    
    const header = document.createElement("div");
    header.className = "danger-header";
    
    const category = document.createElement("span");
    category.className = "danger-category";
    category.textContent = d.category || "Other";
    
    const severityBadge = document.createElement("span");
    severityBadge.className = "danger-severity";
    severityBadge.innerHTML = `${severity}/5`;
    
    header.appendChild(category);
    header.appendChild(severityBadge);
    
    const description = document.createElement("p");
    description.className = "danger-description";
    description.textContent = d.description || "";
    
    content.appendChild(header);
    content.appendChild(description);
    
    li.innerHTML = iconSvg;
    li.appendChild(content);
    ul.appendChild(li);
  }
}

function setSources(ul, sources) {
  if (!ul) return;
  ul.innerHTML = "";
  for (const s of sources || []) {
    const li = document.createElement("li");
    const a = document.createElement("a");
    const pub = s.publisher ? `${s.publisher} — ` : "";
    a.href = s.url;
    a.target = "_blank";
    a.rel = "noreferrer";
    a.textContent = `${pub}${s.title}`;
    li.appendChild(a);
    ul.appendChild(li);
  }
}

// ============================================
// Verdict Helpers
// ============================================

function verdictLabel(verdict) {
  return humanizeEnum(verdict || "");
}

function verdictClass(verdict) {
  switch (String(verdict || "")) {
    case "supported": return "supported";
    case "contradicted": return "contradicted";
    case "mixed": return "mixed";
    case "unverifiable": return "unverifiable";
    case "not_a_factual_claim": return "notclaim";
    default: return "unverifiable";
  }
}

function verdictColor(verdict) {
  switch (String(verdict || "")) {
    case "supported": return "var(--success)";
    case "contradicted": return "var(--danger)";
    case "mixed": return "var(--warning)";
    case "unverifiable":
    case "not_a_factual_claim":
    default: return "var(--text-muted)";
  }
}

// ============================================
// Claim Rendering
// ============================================

function metricRow({ label, valueText, percent, color }) {
  const wrap = document.createElement("div");
  wrap.className = "metric";

  const head = document.createElement("div");
  head.className = "metric-head";

  const l = document.createElement("div");
  l.className = "metric-label";
  l.textContent = label;

  const v = document.createElement("div");
  v.className = "metric-value";
  const bdi = document.createElement("bdi");
  bdi.setAttribute("dir", "ltr");
  bdi.textContent = valueText;
  v.appendChild(bdi);

  head.appendChild(l);
  head.appendChild(v);

  const bar = document.createElement("div");
  bar.className = "metric-bar";
  const fill = document.createElement("div");
  fill.className = "metric-fill";
  fill.style.width = `${Math.max(0, Math.min(100, Number(percent) || 0))}%`;
  fill.style.background = color;
  bar.appendChild(fill);

  wrap.appendChild(head);
  wrap.appendChild(bar);
  return wrap;
}

function renderClaimSources(sources) {
  const ul = document.createElement("ul");
  ul.className = "claim-sources";
  for (const s of sources || []) {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = s.url;
    a.target = "_blank";
    a.rel = "noreferrer";
    const pub = s.publisher ? `${s.publisher} — ` : "";
    a.textContent = `${pub}${s.title}`;
    li.appendChild(a);
    ul.appendChild(li);
  }
  return ul;
}

function renderClaims(claims) {
  if (!els.claimsList) return;
  els.claimsList.innerHTML = "";

  const list = Array.isArray(claims) ? claims.slice() : [];
  list.sort((a, b) => Number(b?.weight ?? 0) - Number(a?.weight ?? 0));

  if (list.length === 0) {
    const empty = document.createElement("div");
    empty.className = "text-muted";
    empty.style.padding = "20px";
    empty.style.textAlign = "center";
    empty.textContent = "No claims extracted.";
    els.claimsList.appendChild(empty);
    return;
  }

  list.forEach((c, index) => {
    const details = document.createElement("details");
    details.className = `claim-card claim-card_${verdictClass(c?.verdict)}`;
    details.style.animationDelay = `${index * 0.05}s`;

    const summary = document.createElement("summary");
    summary.className = "claim-summary";

    const sumInner = document.createElement("div");
    sumInner.className = "claim-summary-inner";

    const text = document.createElement("div");
    text.className = "claim-text";
    text.textContent = c?.claim || "";

    const chips = document.createElement("div");
    chips.className = "chips";

    const verdict = document.createElement("span");
    verdict.className = `chip chip-verdict chip-verdict_${verdictClass(c?.verdict)}`;
    verdict.setAttribute("dir", "ltr");
    verdict.textContent = verdictLabel(c?.verdict) || "Unverifiable";

    const weight = Number(c?.weight ?? 0);
    const weightChip = document.createElement("span");
    weightChip.className = "chip";
    weightChip.setAttribute("dir", "ltr");
    weightChip.textContent = `W:${Math.max(0, Math.min(100, weight))}`;

    const conf = Number(c?.confidence ?? 0);
    const confChip = document.createElement("span");
    confChip.className = "chip";
    confChip.setAttribute("dir", "ltr");
    confChip.textContent = `C:${Math.max(0, Math.min(100, conf))}`;

    chips.appendChild(verdict);
    chips.appendChild(weightChip);
    chips.appendChild(confChip);

    sumInner.appendChild(text);
    sumInner.appendChild(chips);
    summary.appendChild(sumInner);

    const body = document.createElement("div");
    body.className = "claim-body";

    body.appendChild(
      metricRow({
        label: "Centrality (weight)",
        valueText: `${Math.max(0, Math.min(100, weight))}/100`,
        percent: weight,
        color: "linear-gradient(90deg, var(--accent), #5eead4)",
      }),
    );

    body.appendChild(
      metricRow({
        label: "Evidence confidence",
        valueText: `${Math.max(0, Math.min(100, conf))}/100`,
        percent: conf,
        color: `linear-gradient(90deg, ${verdictColor(c?.verdict)}, rgba(255,255,255,0.1))`,
      }),
    );

    const explanation = document.createElement("div");
    explanation.className = "claim-section";
    const exLabel = document.createElement("div");
    exLabel.className = "section-label";
    exLabel.textContent = "Explanation";
    const exText = document.createElement("div");
    exText.className = "section-text";
    exText.textContent = c?.explanation || "";
    explanation.appendChild(exLabel);
    explanation.appendChild(exText);
    body.appendChild(explanation);

    const correctionText = (c?.correction || "").trim();
    if (correctionText) {
      const corr = document.createElement("div");
      corr.className = "callout";
      const corrLabel = document.createElement("div");
      corrLabel.className = "section-label";
      corrLabel.textContent = "Correction";
      const corrBody = document.createElement("div");
      corrBody.className = "section-text";
      corrBody.textContent = correctionText;
      corr.appendChild(corrLabel);
      corr.appendChild(corrBody);
      body.appendChild(corr);
    }

    const sources = Array.isArray(c?.sources) ? c.sources : [];
    if (sources.length) {
      const src = document.createElement("div");
      src.className = "claim-section";
      const sLabel = document.createElement("div");
      sLabel.className = "section-label";
      sLabel.textContent = "Sources";
      src.appendChild(sLabel);
      src.appendChild(renderClaimSources(sources));
      body.appendChild(src);
    }

    details.appendChild(summary);
    details.appendChild(body);
    els.claimsList.appendChild(details);
  });
}

// ============================================
// API Functions
// ============================================

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.detail || `Request failed (${res.status})`);
  }
  return data;
}

async function getJson(url) {
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.detail || `Request failed (${res.status})`);
  }
  return data;
}

async function pollJob(jobId) {
  while (true) {
    const job = await getJson(`/api/jobs/${jobId}`);
    if (els.statusText) els.statusText.textContent = humanizeEnum(job.status);
    setProgress(job.progress);

    if (job.status === "failed") {
      showAlert(els.errorBox, job.error || "Unknown error occurred.");
      setHidden(els.infoBox, true);
      setHidden(els.resultCard, true);
      return;
    }

    if (job.status === "completed") {
      setHidden(els.errorBox, true);
      setHidden(els.infoBox, true);
      renderResult(job);
      return;
    }

    await new Promise((r) => setTimeout(r, 2000));
  }
}

// ============================================
// Alert Helpers
// ============================================

function showAlert(alertEl, message) {
  if (!alertEl) return;
  const textEl = alertEl.querySelector('.alert-text');
  if (textEl) textEl.textContent = message;
  setHidden(alertEl, false);
}

// ============================================
// Score & Results
// ============================================

function humanizeEnum(value) {
  if (!value) return "";
  return String(value)
    .replaceAll("_", " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function scoreColor(score) {
  const s = Number(score ?? 0);
  if (s < 50) return "var(--danger)";
  if (s < 80) return "var(--warning)";
  return "var(--success)";
}

function renderResult(job) {
  setHidden(els.resultCard, false);
  currentReportLanguage = job.output_language || currentReportLanguage || selectedLanguage.code;
  applyOutputDirection();
  setDetailsTab(activeDetailsTab || "claims");

  const score = Number(job.report?.overall_score ?? 0);
  const clampedScore = Math.max(0, Math.min(100, score));
  
  // Update score display with animation
  if (els.scorePct) {
    animateNumber(els.scorePct, 0, clampedScore, 1000);
  }
  
  if (els.scoreCircle) {
    els.scoreCircle.style.setProperty("--pct", String(clampedScore));
    els.scoreCircle.style.setProperty("--score-color", scoreColor(score));
  }

  const verdict = humanizeEnum(job.report?.overall_verdict);
  if (els.verdictText) {
    els.verdictText.textContent = verdict ? `${verdict}` : "";
    // Add color based on verdict
    const verdictLower = String(job.report?.overall_verdict || "").toLowerCase();
    if (verdictLower.includes("true") || verdictLower === "supported") {
      els.verdictText.style.borderColor = "var(--success)";
      els.verdictText.style.color = "var(--success)";
    } else if (verdictLower.includes("false") || verdictLower === "contradicted") {
      els.verdictText.style.borderColor = "var(--danger)";
      els.verdictText.style.color = "#fca5a5";
    } else if (verdictLower.includes("mixed")) {
      els.verdictText.style.borderColor = "var(--warning)";
      els.verdictText.style.color = "var(--warning)";
    }
  }

  const generated = job.report?.generated_at;
  if (els.generatedAt) {
    if (generated) {
      const d = new Date(generated);
      els.generatedAt.textContent = Number.isNaN(d.getTime()) ? String(generated) : d.toLocaleString();
    } else {
      els.generatedAt.textContent = "";
    }
  }

  if (els.reportSummary) {
    els.reportSummary.textContent = job.report?.summary || "";
  }
  
  setList(els.whatsRight, job.report?.whats_right || []);
  setList(els.whatsWrong, job.report?.whats_wrong || []);
  setDangerList(els.dangerList, job.report?.danger || []);
  setSources(els.sourcesList, job.report?.sources_used || []);
  renderClaims(job.report?.claims || []);
  
  if (els.transcript) {
    els.transcript.textContent = formatTranscript(job.transcript || "");
  }
  
  // Scroll to results
  setTimeout(() => {
    els.resultCard?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 100);
}

// Animate number counting up
function animateNumber(element, start, end, duration) {
  const startTime = performance.now();
  const percentSpan = element.querySelector('.score-percent');
  
  function update(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    
    // Easing function for smooth animation
    const easeOut = 1 - Math.pow(1 - progress, 3);
    const current = Math.round(start + (end - start) * easeOut);
    
    // Update text while preserving the percent span
    if (percentSpan) {
      element.innerHTML = `${current}<span class="score-percent">%</span>`;
    } else {
      element.textContent = `${current}%`;
    }
    
    if (progress < 1) {
      requestAnimationFrame(update);
    }
  }
  
  requestAnimationFrame(update);
}

// ============================================
// Language Dropdown
// ============================================

function openLangMenu() {
  setHidden(els.langMenu, false);
  els.langDropdown?.classList.add('open');
  if (els.langSearch) {
    els.langSearch.value = "";
    els.langSearch.focus();
  }
  renderLangList("");
}

function closeLangMenu() {
  setHidden(els.langMenu, true);
  els.langDropdown?.classList.remove('open');
}

function renderLangList(filter) {
  if (!els.langList) return;
  
  const q = (filter || "").trim().toLowerCase();
  const items = LANGUAGES.filter((l) => {
    if (!q) return true;
    return l.name.toLowerCase().includes(q) || l.code.toLowerCase().includes(q);
  });

  els.langList.innerHTML = "";
  for (const l of items) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "dropdownItem";
    btn.innerHTML = `${l.name} <span class="code">(${l.code})</span>`;
    btn.addEventListener("click", () => {
      selectedLanguage = l;
      if (els.langLabel) els.langLabel.textContent = l.name;
      closeLangMenu();
    });
    els.langList.appendChild(btn);
  }
}

els.langButton?.addEventListener("click", () => {
  const isOpen = !els.langMenu?.classList.contains("hidden");
  if (isOpen) closeLangMenu();
  else openLangMenu();
});

els.langSearch?.addEventListener("input", (e) => renderLangList(e.target.value));

document.addEventListener("click", (e) => {
  if (els.langDropdown && !els.langDropdown.contains(e.target)) closeLangMenu();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeLangMenu();
});

function setSelectedLanguageByCode(code) {
  const c = String(code || "").toLowerCase();
  const match = LANGUAGES.find((l) => l.code === c);
  if (match) {
    selectedLanguage = match;
    setText(els.langLabel, match.name);
  }
}

// ============================================
// History
// ============================================

function formatWhen(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString();
}

function renderHistory(items) {
  if (!els.historyList) return;
  els.historyList.innerHTML = "";
  
  if (!items || items.length === 0) {
    const empty = document.createElement("div");
    empty.style.padding = "40px 20px";
    empty.style.textAlign = "center";
    empty.style.color = "var(--text-muted)";
    empty.innerHTML = `
      <svg style="width: 48px; height: 48px; margin-bottom: 12px; opacity: 0.5;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <circle cx="12" cy="12" r="10"/>
        <polyline points="12,6 12,12 16,14"/>
      </svg>
      <p style="margin: 0; font-size: 14px;">No analyses yet. Start by analyzing a video!</p>
    `;
    els.historyList.appendChild(empty);
    return;
  }

  items.forEach((item, index) => {
    const row = document.createElement("div");
    row.className = "history-item";
    row.style.animationDelay = `${index * 0.05}s`;

    const score = typeof item.overall_score === "number" ? item.overall_score : null;
    const scoreEl = document.createElement("div");
    scoreEl.className = "history-score";
    if (score !== null) {
      scoreEl.style.color = scoreColor(score);
      scoreEl.textContent = `${score}%`;
    } else {
      scoreEl.style.color = "var(--text-muted)";
      scoreEl.textContent = "—";
    }

    const meta = document.createElement("div");
    meta.className = "history-meta";
    
    const url = document.createElement("div");
    url.className = "history-url";
    url.textContent = item.url || "";
    url.title = item.url || "";
    
    const badges = document.createElement("div");
    badges.className = "history-badges";
    
    const langBadge = document.createElement("span");
    langBadge.className = "badge";
    langBadge.textContent = (item.output_language || "ar").toUpperCase();
    
    const statusBadge = document.createElement("span");
    statusBadge.className = "badge";
    statusBadge.textContent = humanizeEnum(item.status) || "";
    
    const timeBadge = document.createElement("span");
    timeBadge.className = "badge";
    timeBadge.textContent = formatWhen(item.updated_at);
    
    badges.appendChild(langBadge);
    badges.appendChild(statusBadge);
    badges.appendChild(timeBadge);
    meta.appendChild(url);
    meta.appendChild(badges);

    const actions = document.createElement("div");
    const openBtn = document.createElement("button");
    openBtn.type = "button";
    openBtn.className = "btn btn-ghost btn-sm";
    openBtn.innerHTML = `
      <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
        <polyline points="15 3 21 3 21 9"/>
        <line x1="10" y1="14" x2="21" y2="3"/>
      </svg>
      Open
    `;
    openBtn.addEventListener("click", async () => {
      try {
        openBtn.disabled = true;
        const job = await getJson(`/api/jobs/${item.id}`);
        setHidden(els.errorBox, true);
        setHidden(els.statusCard, true);
        if (els.url) els.url.value = job.url || "";
        lastSubmittedUrl = job.url || "";
        setSelectedLanguageByCode(job.output_language || "ar");
        if (els.forceRun) els.forceRun.checked = false;
        showAlert(els.infoBox, "Loaded from history.");
        renderResult(job);
        setHidden(els.historyCard, true);
      } catch (e) {
        showAlert(els.errorBox, e?.message || String(e));
      } finally {
        openBtn.disabled = false;
      }
    });
    actions.appendChild(openBtn);

    row.appendChild(scoreEl);
    row.appendChild(meta);
    row.appendChild(actions);
    els.historyList.appendChild(row);
  });
}

async function loadHistory() {
  try {
    const items = await getJson("/api/history?limit=50");
    renderHistory(items);
  } catch (e) {
    if (els.historyList) {
      els.historyList.innerHTML = `
        <div style="padding: 20px; text-align: center; color: var(--danger);">
          Failed to load history: ${e.message}
        </div>
      `;
    }
  }
}

// ============================================
// Analysis
// ============================================

async function runAnalysis({ force }) {
  const url = els.url?.value.trim();
  if (!url) {
    showAlert(els.errorBox, "Please enter a video URL.");
    return;
  }
  lastSubmittedUrl = url;

  // Set loading state
  if (els.run) {
    els.run.disabled = true;
    els.run.classList.add('loading');
  }
  
  setHidden(els.statusCard, false);
  setHidden(els.resultCard, true);
  setHidden(els.errorBox, true);
  setHidden(els.infoBox, true);
  
  if (els.statusText) els.statusText.textContent = "Queued";
  setProgress(0);
  
  // Reset step states
  statusSteps.forEach(step => {
    step.classList.remove('active', 'completed');
  });

  try {
    const { job_id, cached } = await postJson("/api/analyze", {
      url,
      output_language: selectedLanguage.code,
      force: Boolean(force),
    });
    
    if (cached) {
      showAlert(els.infoBox, "Loaded from cache. Enable 'Re-run' to refresh.");
    }
    
    await pollJob(job_id);
  } catch (e) {
    showAlert(els.errorBox, e?.message || String(e));
  } finally {
    if (els.run) {
      els.run.disabled = false;
      els.run.classList.remove('loading');
    }
  }
}

// ============================================
// New Analysis / Reset
// ============================================

function startNewAnalysis() {
  // Clear URL input
  if (els.url) {
    els.url.value = "";
    els.url.focus();
  }
  
  // Reset checkbox
  if (els.forceRun) els.forceRun.checked = false;
  
  // Hide all result/status cards
  setHidden(els.statusCard, true);
  setHidden(els.resultCard, true);
  setHidden(els.historyCard, true);
  setHidden(els.errorBox, true);
  setHidden(els.infoBox, true);
  
  // Reset progress
  setProgress(0);
  statusSteps.forEach(step => step.classList.remove('active', 'completed'));
  
  // Reset state
  lastSubmittedUrl = "";
  currentReportLanguage = null;
  
  // Scroll to top smoothly
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ============================================
// Event Listeners
// ============================================

els.newAnalysis?.addEventListener("click", startNewAnalysis);

els.logoLink?.addEventListener("click", (e) => {
  e.preventDefault();
  startNewAnalysis();
});

els.run?.addEventListener("click", async () => {
  await runAnalysis({ force: els.forceRun?.checked });
});

// Allow Enter key to submit
els.url?.addEventListener("keydown", async (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    await runAnalysis({ force: els.forceRun?.checked });
  }
});

els.rerunBtn?.addEventListener("click", async () => {
  if (lastSubmittedUrl && els.url) els.url.value = lastSubmittedUrl;
  if (els.forceRun) els.forceRun.checked = true;
  await runAnalysis({ force: true });
});

if (els.historyToggle && els.historyCard) {
  els.historyToggle.addEventListener("click", async () => {
    const isHidden = els.historyCard.classList.contains("hidden");
    setHidden(els.historyCard, !isHidden);
    if (isHidden) {
      await loadHistory();
    }
  });
}

els.historyRefresh?.addEventListener("click", async () => {
  const btn = els.historyRefresh;
  const icon = btn?.querySelector('.btn-icon');
  if (icon) icon.style.animation = 'spin 0.5s linear';
  await loadHistory();
  if (icon) setTimeout(() => icon.style.animation = '', 500);
});

els.tabClaims?.addEventListener("click", () => setDetailsTab("claims"));
els.tabSources?.addEventListener("click", () => setDetailsTab("sources"));
els.tabTranscript?.addEventListener("click", () => setDetailsTab("transcript"));

// ============================================
// Initialize
// ============================================

// Initialize language dropdown
renderLangList("");

// Add subtle parallax effect to background glows
document.addEventListener('mousemove', (e) => {
  const glows = document.querySelectorAll('.bg-glow');
  const x = e.clientX / window.innerWidth;
  const y = e.clientY / window.innerHeight;
  
  glows.forEach((glow, index) => {
    const speed = (index + 1) * 10;
    const offsetX = (x - 0.5) * speed;
    const offsetY = (y - 0.5) * speed;
    glow.style.transform = `translate(${offsetX}px, ${offsetY}px)`;
  });
});

// Input focus animation
els.url?.addEventListener('focus', () => {
  els.url.parentElement?.classList.add('focused');
});

els.url?.addEventListener('blur', () => {
  els.url.parentElement?.classList.remove('focused');
});
