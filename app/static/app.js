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
  historyClear: document.getElementById("historyClear"),
  historyList: document.getElementById("historyList"),
  historySearch: document.getElementById("historySearch"),

  statusCard: document.getElementById("statusCard"),
  statusText: document.getElementById("statusText"),
  progressPill: document.getElementById("progressPill"),
  progressBar: document.getElementById("progressBar"),
  infoBox: document.getElementById("infoBox"),
  errorBox: document.getElementById("errorBox"),
  thoughtsBox: document.getElementById("thoughtsBox"),
  thoughtsList: document.getElementById("thoughtsList"),
  thoughtsCount: document.getElementById("thoughtsCount"),
  progressToggle: document.getElementById("progressToggle"),
  resultCard: document.getElementById("resultCard"),
  scoreCircle: document.getElementById("scoreCircle"),
  scorePct: document.getElementById("scorePct"),
  verdictText: document.getElementById("verdictText"),
  generatedAt: document.getElementById("generatedAt"),
  shareBtn: document.getElementById("shareBtn"),
  exportDropdown: document.getElementById("exportDropdown"),
  exportBtn: document.getElementById("exportBtn"),
  exportMenu: document.getElementById("exportMenu"),
  exportPdf: document.getElementById("exportPdf"),
  exportPng: document.getElementById("exportPng"),
  exportMount: document.getElementById("exportMount"),
  rerunBtn: document.getElementById("rerunBtn"),
  reportSummary: document.getElementById("reportSummary"),
  whatsRight: document.getElementById("whatsRight"),
  whatsWrong: document.getElementById("whatsWrong"),
  contextSection: document.getElementById("contextSection"),
  contextMissingBlock: document.getElementById("contextMissingBlock"),
  contextLimitationsBlock: document.getElementById("contextLimitationsBlock"),
  missingContextList: document.getElementById("missingContextList"),
  limitationsText: document.getElementById("limitationsText"),
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
let lastKnownStatus = null;
let currentThoughtJobId = null;
let displayedThoughtCount = 0;
let currentJob = null;
let currentJobId = null;
let pollSeq = 0;
let progressBoxCollapsed = false;
let userScrolledUp = false;

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

  const outputEls = [
    els.reportSummary,
    els.whatsRight,
    els.whatsWrong,
    els.missingContextList,
    els.limitationsText,
    els.dangerList,
    els.claimsList,
  ];
  for (const el of outputEls) {
    if (!el) continue;
    el.setAttribute("dir", dir);
    el.setAttribute("lang", lang);
  }

  if (els.sourcesList) els.sourcesList.setAttribute("dir", "auto");
  if (els.transcript) els.transcript.setAttribute("dir", "auto");
}

// ============================================
// Routing (Shareable Run Pages)
// ============================================

function getJobIdFromLocation() {
  const m = window.location.pathname.match(/^\/r\/([a-f0-9]+)$/i);
  if (m && m[1]) return m[1];

  const fromWindow = String(window.__INITIAL_JOB_ID__ || "").trim();
  if (fromWindow) return fromWindow;

  const params = new URLSearchParams(window.location.search);
  const q = params.get("job");
  if (q) return q;

  return null;
}

function shareUrlForJob(jobId) {
  if (!jobId) return window.location.href;
  return `${window.location.origin}/r/${jobId}`;
}

function navigateToJob(jobId, { replace } = {}) {
  if (!jobId) return;
  const next = `/r/${jobId}`;
  const current = window.location.pathname;
  if (current === next) return;
  if (replace) history.replaceState({ jobId }, "", next);
  else history.pushState({ jobId }, "", next);
}

function navigateHome({ replace } = {}) {
  const next = "/";
  const current = window.location.pathname;
  if (current === next) return;
  if (replace) history.replaceState({}, "", next);
  else history.pushState({}, "", next);
}

function cancelPolling() {
  pollSeq += 1;
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
  updateStatusSteps(pct, lastKnownStatus);
}

function updateStatusSteps(pct, status) {
  const statusStr = String(status || "").toLowerCase();

  const states = {
    download: "",
    transcribe: "",
    analyze: "",
    report: "",
  };

  if (statusStr === "completed" || Number(pct) >= 100) {
    states.download = "completed";
    states.transcribe = "completed";
    states.analyze = "completed";
    states.report = "completed";
  } else if (statusStr === "fact_checking" || statusStr === "translating") {
    states.download = "completed";
    states.transcribe = "completed";
    states.analyze = "active";
  } else if (statusStr === "transcribing") {
    states.download = "completed";
    states.transcribe = "active";
  } else if (statusStr === "downloading" || statusStr === "fetching_transcript" || statusStr === "queued") {
    states.download = "active";
  } else if (statusStr === "failed") {
    const p = Number(pct) || 0;
    if (p < 15) {
      states.download = "active";
    } else if (p < 30) {
      states.download = "completed";
      states.transcribe = "active";
    } else {
      states.download = "completed";
      states.transcribe = "completed";
      states.analyze = "active";
    }
  } else {
    const p = Number(pct) || 0;
    if (p < 10) {
      states.download = "active";
    } else if (p < 30) {
      states.download = "completed";
      states.transcribe = "active";
    } else {
      states.download = "completed";
      states.transcribe = "completed";
      states.analyze = "active";
    }
  }

  statusSteps.forEach((step) => {
    step.classList.remove("active", "completed");
    const name = step.dataset.step;
    const st = states[name];
    if (st === "completed") step.classList.add("completed");
    if (st === "active") step.classList.add("active");
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

function setContextInfo(missingContext, limitations) {
  const missing = Array.isArray(missingContext)
    ? missingContext.map((item) => String(item ?? "").trim()).filter(Boolean)
    : [];
  const limits = String(limitations ?? "").trim();
  const hasMissing = missing.length > 0;
  const hasLimits = !!limits;

  setHidden(els.contextSection, !(hasMissing || hasLimits));
  setHidden(els.contextMissingBlock, !hasMissing);
  setHidden(els.contextLimitationsBlock, !hasLimits);

  setList(els.missingContextList, missing);
  setText(els.limitationsText, limits);
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

// Simple markdown parser for progress items
function parseSimpleMarkdown(text) {
  let html = text
    // Escape HTML first
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // Headers (## Header)
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    // Bold (**text** or __text__)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g, '<strong>$1</strong>')
    // Italic (*text* or _text_)
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/_(.+?)_/g, '<em>$1</em>')
    // Inline code (`code`)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Links [text](url)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    // Blockquotes (> text)
    .replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>')
    // Unordered lists (- item or * item)
    .replace(/^[\-\*] (.+)$/gm, '<li>$1</li>')
    // Numbered lists (1. item)
    .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
    // Line breaks
    .replace(/\n\n+/g, '</p><p>')
    .replace(/\n/g, '<br>');
  
  // Wrap consecutive <li> items in <ul>
  html = html.replace(/(<li>.*?<\/li>)(\s*<br>\s*)?(<li>)/g, '$1$3');
  html = html.replace(/(<li>.*?<\/li>(?:\s*<li>.*?<\/li>)*)/g, '<ul>$1</ul>');
  
  // Wrap in paragraph if not starting with block element
  if (!html.match(/^<(h[1-6]|ul|ol|blockquote|p)/)) {
    html = '<p>' + html + '</p>';
  }
  
  // Clean up empty paragraphs
  html = html.replace(/<p><\/p>/g, '').replace(/<p>\s*<\/p>/g, '');
  
  return html;
}

function resetThoughtSummaries() {
  currentThoughtJobId = null;
  displayedThoughtCount = 0;
  userScrolledUp = false;
  progressBoxCollapsed = false;
  if (els.thoughtsList) els.thoughtsList.innerHTML = "";
  setText(els.thoughtsCount, "0");
  setHidden(els.thoughtsBox, true);
  if (els.thoughtsBox) {
    els.thoughtsBox.classList.remove("collapsed", "active");
  }
}

function collapseProgressBox(collapse) {
  progressBoxCollapsed = collapse;
  if (els.thoughtsBox) {
    els.thoughtsBox.classList.toggle("collapsed", collapse);
  }
}

function updateThoughtSummaries(job, jobId) {
  if (!els.thoughtsBox || !els.thoughtsList) return;

  if (currentThoughtJobId !== jobId) {
    currentThoughtJobId = jobId;
    displayedThoughtCount = 0;
    userScrolledUp = false;
    els.thoughtsList.innerHTML = "";
  }

  const summaries = Array.isArray(job?.thought_summaries) ? job.thought_summaries : [];
  setText(els.thoughtsCount, String(summaries.length || 0));

  if (!summaries.length) {
    setHidden(els.thoughtsBox, true);
    els.thoughtsBox.classList.remove("active");
    return;
  }

  const listEl = els.thoughtsList;

  setHidden(els.thoughtsBox, false);
  els.thoughtsBox.classList.add("active");
  
  // Check if there are actually new items to add
  const hasNewItems = summaries.length > displayedThoughtCount;
  
  // Only remove 'latest' from previous items if we're adding new ones
  if (hasNewItems) {
    const prevLatest = listEl.querySelectorAll(".progress-item.latest, .progress-item.new-item");
    prevLatest.forEach(el => {
      el.classList.remove("latest", "new-item");
    });
  }

  // Add new items one by one at the TOP (prepend)
  for (let i = displayedThoughtCount; i < summaries.length; i++) {
    const text = String(summaries[i] ?? "").trim();
    if (!text) continue;
    
    const item = document.createElement("div");
    item.className = "progress-item latest new-item";
    item.setAttribute("dir", "auto");
    
    // Create content wrapper for markdown
    const contentWrapper = document.createElement("div");
    contentWrapper.className = "progress-item-content";
    contentWrapper.innerHTML = parseSimpleMarkdown(text);
    item.appendChild(contentWrapper);
    
    // Add timestamp
    const timeEl = document.createElement("span");
    timeEl.className = "progress-item-time";
    timeEl.textContent = new Date().toLocaleTimeString();
    item.appendChild(timeEl);
    
    // Prepend to list so newest is at top
    listEl.insertBefore(item, listEl.firstChild);
    
    // Remove new-item class after animation completes
    setTimeout(() => {
      item.classList.remove("new-item");
    }, 700);
  }
  displayedThoughtCount = summaries.length;

  // Auto-scroll to top (where latest item is) only if user hasn't scrolled down
  if (!userScrolledUp) {
    listEl.scrollTop = 0;
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
    cache: "no-store",
    credentials: "same-origin",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.detail || `Request failed (${res.status})`);
  }
  return data;
}

async function getJson(url) {
  const res = await fetch(url, { cache: "no-store", credentials: "same-origin" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.detail || `Request failed (${res.status})`);
  }
  return data;
}

async function pollJob(jobId) {
  const seq = ++pollSeq;
  currentJobId = jobId;

  while (seq === pollSeq) {
    const job = await getJson(`/api/jobs/${jobId}`);
    lastKnownStatus = job.status;
    if (els.statusText) els.statusText.textContent = humanizeEnum(job.status);
    setProgress(job.progress);
    updateThoughtSummaries(job, jobId);

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

function reportFrontendError(prefix, err) {
  const message = err instanceof Error ? err.message : String(err ?? "Unknown error");
  console.error(prefix, err);
  setHidden(els.statusCard, false);
  showAlert(els.errorBox, `${prefix}: ${message}`);
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
  currentJob = job || null;
  currentJobId = job?.id || currentJobId;
  setHidden(els.resultCard, false);
  
  // Auto-collapse progress box when showing results
  collapseProgressBox(true);
  if (els.thoughtsBox) {
    els.thoughtsBox.classList.remove("active");
  }
  
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
  setContextInfo(job.report?.missing_context, job.report?.limitations);
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
// Export (PDF / PNG)
// ============================================

function openExportMenu() {
  setHidden(els.exportMenu, false);
  els.exportDropdown?.classList.add("open");
  els.exportBtn?.setAttribute("aria-expanded", "true");
}

function closeExportMenu() {
  setHidden(els.exportMenu, true);
  els.exportDropdown?.classList.remove("open");
  els.exportBtn?.setAttribute("aria-expanded", "false");
}

function setExportBusy(busy, label) {
  if (els.exportBtn) {
    els.exportBtn.disabled = !!busy;
    const textEl = els.exportBtn.querySelector(".btn-text");
    if (textEl) {
      if (busy) {
        if (!els.exportBtn.dataset.originalText) {
          els.exportBtn.dataset.originalText = textEl.textContent || "Export";
        }
        textEl.textContent = label || "Exporting…";
      } else {
        textEl.textContent = els.exportBtn.dataset.originalText || "Export";
      }
    }
  }
  if (els.exportPdf) els.exportPdf.disabled = !!busy;
  if (els.exportPng) els.exportPng.disabled = !!busy;
}

function ensureExportLibs() {
  const hasCanvas = typeof window.html2canvas === "function";
  const hasPdf = typeof window.jspdf?.jsPDF === "function";
  if (!hasCanvas || !hasPdf) {
    throw new Error("Export libraries failed to load. Refresh the page and try again.");
  }
}

function reportExportError(err) {
  const message = err instanceof Error ? err.message : String(err ?? "Unknown error");
  console.error("Export error:", err);
  showAlert(els.errorBox, `Export failed: ${message}`);
  setHidden(els.infoBox, true);
}

function exportFileBase(job) {
  const id = String(job?.id || "report").slice(0, 10).toLowerCase();
  const generated = job?.report?.generated_at;
  const date = (() => {
    if (!generated) return new Date().toISOString().slice(0, 10);
    const d = new Date(generated);
    return Number.isNaN(d.getTime()) ? new Date().toISOString().slice(0, 10) : d.toISOString().slice(0, 10);
  })();
  return `verifyai-report-${id}-${date}`;
}

function exportToneForOverallVerdict(v) {
  const s = String(v || "").toLowerCase();
  if (s === "accurate" || s === "mostly_accurate") return "good";
  if (s === "mixed") return "warn";
  if (s === "misleading" || s === "false") return "bad";
  return "muted";
}

function exportToneForScore(score) {
  const s = Number(score);
  if (!Number.isFinite(s)) return "muted";
  if (s < 50) return "bad";
  if (s < 80) return "warn";
  return "good";
}

function exportToneForClaimVerdict(v) {
  const s = String(v || "").toLowerCase();
  if (s === "supported") return "good";
  if (s === "mixed") return "warn";
  if (s === "contradicted") return "bad";
  return "muted";
}

function buildExportDocument(job) {
  const report = job?.report || {};
  const lang = String(job?.output_language || currentReportLanguage || selectedLanguage?.code || "en").toLowerCase();
  const contentDir = isRtlLanguage(lang) ? "rtl" : "ltr";

  const root = document.createElement("div");
  root.className = "export-document";
  root.setAttribute("dir", "ltr");
  root.setAttribute("lang", "en");

  const header = document.createElement("div");
  header.className = "export-header";

  const brand = document.createElement("div");
  brand.className = "export-brand";

  const brandTop = document.createElement("div");
  brandTop.className = "export-brand-top";

  const product = document.createElement("div");
  product.className = "export-product";
  product.textContent = "VerifyAI";

  const docTitle = document.createElement("div");
  docTitle.className = "export-doc-title";
  docTitle.textContent = "Fact-Check Report";

  brandTop.appendChild(product);
  brandTop.appendChild(docTitle);

  const meta = document.createElement("div");
  meta.className = "export-meta";

  const addMetaRow = (label, value, { dir } = {}) => {
    if (!value) return;
    const row = document.createElement("div");
    row.className = "export-meta-row";
    const l = document.createElement("div");
    l.className = "export-meta-label";
    l.textContent = label;
    const v = document.createElement("div");
    v.className = "export-meta-value";
    if (dir) v.setAttribute("dir", dir);
    v.textContent = value;
    row.appendChild(l);
    row.appendChild(v);
    meta.appendChild(row);
  };

  addMetaRow("Generated", (() => {
    const g = report?.generated_at;
    if (!g) return "";
    const d = new Date(g);
    return Number.isNaN(d.getTime()) ? String(g) : d.toLocaleString();
  })());
  addMetaRow("Video URL", String(job?.url || ""), { dir: "ltr" });
  addMetaRow("Job ID", String(job?.id || ""), { dir: "ltr" });
  addMetaRow("Language", String(job?.output_language || "").toUpperCase(), { dir: "ltr" });

  brand.appendChild(brandTop);
  brand.appendChild(meta);

  const scoreCard = document.createElement("div");
  scoreCard.className = "export-score-card";

  const score = Math.max(0, Math.min(100, Number(report?.overall_score ?? 0)));
  const verdictLabelText = humanizeEnum(report?.overall_verdict) || "";
  const tone = exportToneForOverallVerdict(report?.overall_verdict);
  const scoreTone = exportToneForScore(score);
  scoreCard.dataset.tone = scoreTone;

  const ring = document.createElement("div");
  ring.className = "export-score-ring";

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 120 120");
  svg.setAttribute("class", "export-score-svg");

  const cBg = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  cBg.setAttribute("class", "export-score-bg");
  cBg.setAttribute("cx", "60");
  cBg.setAttribute("cy", "60");
  cBg.setAttribute("r", "54");

  const cFg = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  cFg.setAttribute("class", "export-score-fg");
  cFg.setAttribute("cx", "60");
  cFg.setAttribute("cy", "60");
  cFg.setAttribute("r", "54");

  // circumference for r=54
  const circumference = 339.292;
  const dashOffset = circumference * (1 - score / 100);
  cFg.setAttribute("stroke-dasharray", String(circumference));
  cFg.setAttribute("stroke-dashoffset", String(dashOffset));

  svg.appendChild(cBg);
  svg.appendChild(cFg);

  const ringText = document.createElement("div");
  ringText.className = "export-score-text";

  const scoreValue = document.createElement("div");
  scoreValue.className = "export-score-value";
  scoreValue.setAttribute("dir", "ltr");
  scoreValue.textContent = `${score}%`;

  const scoreSub = document.createElement("div");
  scoreSub.className = "export-score-sub";
  scoreSub.textContent = "Overall score";

  ringText.appendChild(scoreValue);
  ringText.appendChild(scoreSub);

  ring.appendChild(svg);
  ring.appendChild(ringText);

  const verdictPill = document.createElement("div");
  verdictPill.className = "export-verdict";
  verdictPill.dataset.tone = tone;
  verdictPill.textContent = verdictLabelText || "Unverifiable";

  scoreCard.appendChild(ring);
  scoreCard.appendChild(verdictPill);

  header.appendChild(brand);
  header.appendChild(scoreCard);
  root.appendChild(header);

  const addSection = (titleText) => {
    const section = document.createElement("section");
    section.className = "export-section";
    const title = document.createElement("h2");
    title.className = "export-section-title";
    title.textContent = titleText;
    section.appendChild(title);
    root.appendChild(section);
    return section;
  };

  // Summary
  const summarySection = addSection("Summary");
  const summary = document.createElement("p");
  summary.className = "export-summary";
  summary.setAttribute("dir", contentDir);
  summary.setAttribute("lang", lang);
  summary.textContent = String(report?.summary || "").trim() || "—";
  summarySection.appendChild(summary);

  // At-a-glance cards
  const glance = document.createElement("div");
  glance.className = "export-card-grid";

  const makeCard = (titleText, items, { tone: cardTone } = {}) => {
    const card = document.createElement("div");
    card.className = "export-card";
    if (cardTone) card.dataset.tone = cardTone;

    const title = document.createElement("div");
    title.className = "export-card-title";
    title.textContent = titleText;
    card.appendChild(title);

    const list = document.createElement("ul");
    list.className = "export-list";
    list.setAttribute("dir", contentDir);
    list.setAttribute("lang", lang);
    const arr = Array.isArray(items) ? items : [];
    if (!arr.length) {
      const li = document.createElement("li");
      li.className = "export-list-empty";
      li.textContent = "None";
      list.appendChild(li);
    } else {
      for (const it of arr) {
        const li = document.createElement("li");
        li.textContent = String(it ?? "");
        list.appendChild(li);
      }
    }
    card.appendChild(list);
    return card;
  };

  glance.appendChild(makeCard("What's right", report?.whats_right || [], { tone: "good" }));
  glance.appendChild(makeCard("What's wrong", report?.whats_wrong || [], { tone: "bad" }));
  root.appendChild(glance);

  // Missing context / Limitations - separate cards with distinct colors
  const missing = Array.isArray(report?.missing_context) ? report.missing_context : [];
  const limitations = String(report?.limitations || "").trim();
  if (missing.length || limitations) {
    const ctxWrap = document.createElement("div");
    ctxWrap.className = "export-card-grid export-card-grid_2";

    if (missing.length) {
      const missingCard = document.createElement("div");
      missingCard.className = "export-card";
      missingCard.dataset.tone = "warn";

      const missingTitle = document.createElement("div");
      missingTitle.className = "export-card-title";
      missingTitle.textContent = "Missing Context";
      missingCard.appendChild(missingTitle);

      const list = document.createElement("ul");
      list.className = "export-list";
      list.setAttribute("dir", contentDir);
      list.setAttribute("lang", lang);
      for (const it of missing) {
        const li = document.createElement("li");
        li.textContent = String(it ?? "");
        list.appendChild(li);
      }
      missingCard.appendChild(list);
      ctxWrap.appendChild(missingCard);
    }

    if (limitations) {
      const limitsCard = document.createElement("div");
      limitsCard.className = "export-card";
      limitsCard.dataset.tone = "info";

      const limitsTitle = document.createElement("div");
      limitsTitle.className = "export-card-title";
      limitsTitle.textContent = "Limitations";
      limitsCard.appendChild(limitsTitle);

      const p = document.createElement("p");
      p.className = "export-paragraph";
      p.setAttribute("dir", contentDir);
      p.setAttribute("lang", lang);
      p.textContent = limitations;
      limitsCard.appendChild(p);
      ctxWrap.appendChild(limitsCard);
    }

    root.appendChild(ctxWrap);
  }

  // Danger
  const dangerItems = Array.isArray(report?.danger) ? report.danger : [];
  if (dangerItems.length) {
    const dangerSection = addSection("Potential risks & harm");
    const list = document.createElement("div");
    list.className = "export-danger-list";
    for (const d of dangerItems) {
      const item = document.createElement("div");
      item.className = "export-danger-item";
      item.dataset.severity = String(Math.max(0, Math.min(5, Number(d?.severity ?? 0))));

      const head = document.createElement("div");
      head.className = "export-danger-head";

      const cat = document.createElement("div");
      cat.className = "export-danger-category";
      cat.textContent = humanizeEnum(d?.category) || "Other";

      const sev = document.createElement("div");
      sev.className = "export-danger-severity";
      sev.setAttribute("dir", "ltr");
      sev.textContent = `${Math.max(0, Math.min(5, Number(d?.severity ?? 0)))}/5`;

      head.appendChild(cat);
      head.appendChild(sev);

      const desc = document.createElement("div");
      desc.className = "export-danger-desc";
      desc.setAttribute("dir", contentDir);
      desc.setAttribute("lang", lang);
      desc.textContent = String(d?.description || "");

      item.appendChild(head);
      item.appendChild(desc);

      const mitigation = String(d?.mitigation || "").trim();
      if (mitigation) {
        const mit = document.createElement("div");
        mit.className = "export-danger-mitigation";
        mit.setAttribute("dir", contentDir);
        mit.setAttribute("lang", lang);
        mit.textContent = mitigation;
        item.appendChild(mit);
      }

      list.appendChild(item);
    }
    dangerSection.appendChild(list);
  }

  // Claims
  const claims = Array.isArray(report?.claims) ? report.claims.slice() : [];
  claims.sort((a, b) => Number(b?.weight ?? 0) - Number(a?.weight ?? 0));
  const claimsSection = addSection("Claims");
  if (!claims.length) {
    const empty = document.createElement("div");
    empty.className = "export-muted";
    empty.textContent = "No claims extracted.";
    claimsSection.appendChild(empty);
  } else {
    const wrap = document.createElement("div");
    wrap.className = "export-claims";
    claims.forEach((c, idx) => {
      const card = document.createElement("div");
      card.className = "export-claim";
      card.dataset.tone = exportToneForClaimVerdict(c?.verdict);

      const head = document.createElement("div");
      head.className = "export-claim-head";

      const title = document.createElement("div");
      title.className = "export-claim-title";
      title.setAttribute("dir", contentDir);
      title.setAttribute("lang", lang);
      title.textContent = `${idx + 1}. ${String(c?.claim || "").trim()}`;

      const badges = document.createElement("div");
      badges.className = "export-claim-badges";

      const verdict = document.createElement("span");
      verdict.className = "export-pill";
      verdict.dataset.tone = exportToneForClaimVerdict(c?.verdict);
      verdict.setAttribute("dir", "ltr");
      verdict.textContent = verdictLabel(c?.verdict) || "Unverifiable";

      const weight = Math.max(0, Math.min(100, Number(c?.weight ?? 0)));
      const conf = Math.max(0, Math.min(100, Number(c?.confidence ?? 0)));

      const weightP = document.createElement("span");
      weightP.className = "export-pill export-pill_subtle";
      weightP.setAttribute("dir", "ltr");
      weightP.textContent = `W:${weight}`;

      const confP = document.createElement("span");
      confP.className = "export-pill export-pill_subtle";
      confP.setAttribute("dir", "ltr");
      confP.textContent = `C:${conf}`;

      badges.appendChild(verdict);
      badges.appendChild(weightP);
      badges.appendChild(confP);

      head.appendChild(title);
      head.appendChild(badges);

      const explanation = document.createElement("div");
      explanation.className = "export-claim-explanation";
      explanation.setAttribute("dir", contentDir);
      explanation.setAttribute("lang", lang);
      explanation.textContent = String(c?.explanation || "").trim();

      card.appendChild(head);
      card.appendChild(explanation);

      const correction = String(c?.correction || "").trim();
      if (correction) {
        const corr = document.createElement("div");
        corr.className = "export-callout";
        const corrLabel = document.createElement("div");
        corrLabel.className = "export-callout-label";
        corrLabel.textContent = "Correction";
        const corrBody = document.createElement("div");
        corrBody.className = "export-callout-body";
        corrBody.setAttribute("dir", contentDir);
        corrBody.setAttribute("lang", lang);
        corrBody.textContent = correction;
        corr.appendChild(corrLabel);
        corr.appendChild(corrBody);
        card.appendChild(corr);
      }

      const sources = Array.isArray(c?.sources) ? c.sources : [];
      if (sources.length) {
        const srcTitle = document.createElement("div");
        srcTitle.className = "export-subtitle";
        srcTitle.textContent = "Sources";
        const ul = document.createElement("ul");
        ul.className = "export-sources";
        ul.setAttribute("dir", "ltr");
        for (const s of sources) {
          const li = document.createElement("li");
          const pub = s?.publisher ? `${s.publisher} — ` : "";
          const t = String(s?.title || "").trim();
          const url = String(s?.url || "").trim();
          const text = `${pub}${t}${url ? ` (${url})` : ""}`;
          li.textContent = text;
          ul.appendChild(li);
        }
        card.appendChild(srcTitle);
        card.appendChild(ul);
      }

      wrap.appendChild(card);
    });
    claimsSection.appendChild(wrap);
  }

  // Sources used
  const sourcesUsed = Array.isArray(report?.sources_used) ? report.sources_used : [];
  const sourcesSection = addSection("Sources used");
  if (!sourcesUsed.length) {
    const empty = document.createElement("div");
    empty.className = "export-muted";
    empty.textContent = "No sources listed.";
    sourcesSection.appendChild(empty);
  } else {
    const ul = document.createElement("ul");
    ul.className = "export-sources export-sources_block";
    ul.setAttribute("dir", "ltr");
    for (const s of sourcesUsed) {
      const li = document.createElement("li");
      const pub = s?.publisher ? `${s.publisher} — ` : "";
      const t = String(s?.title || "").trim();
      const url = String(s?.url || "").trim();
      const accessed = String(s?.accessed_at || "").trim();
      const suffix = accessed ? ` (accessed ${accessed})` : "";
      li.textContent = `${pub}${t}${url ? ` (${url})` : ""}${suffix}`;
      ul.appendChild(li);
    }
    sourcesSection.appendChild(ul);
  }

  return root;
}

async function waitForExportLayout() {
  try {
    const waitFonts = document.fonts?.ready;
    if (waitFonts) {
      await Promise.race([waitFonts, new Promise((r) => setTimeout(r, 1500))]);
    }
  } catch {
    // ignore
  }

  await new Promise((r) => requestAnimationFrame(r));
  await new Promise((r) => requestAnimationFrame(r));
}

function getExportJobOrThrow() {
  if (!currentJob || !currentJob.report) {
    throw new Error("No completed report to export yet.");
  }
  return currentJob;
}

async function exportReportPdf() {
  ensureExportLibs();
  const job = getExportJobOrThrow();

  if (!els.exportMount) throw new Error("Export mount is missing in the page.");
  els.exportMount.innerHTML = "";
  const doc = buildExportDocument(job);
  els.exportMount.appendChild(doc);

  try {
    await waitForExportLayout();

    const rect = doc.getBoundingClientRect();
    const pageWidthPx = Math.max(1, Math.round(rect.width));
    const pageHeightPx = Math.max(1, Math.round(pageWidthPx * (297 / 210)));
    const totalHeightPx = Math.max(pageHeightPx, Math.round(doc.scrollHeight));
    const pages = Math.max(1, Math.ceil(totalHeightPx / pageHeightPx));

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: "p", unit: "pt", format: "a4" });
    const pageWidthPt = pdf.internal.pageSize.getWidth();
    const pageHeightPt = pdf.internal.pageSize.getHeight();

    for (let p = 0; p < pages; p++) {
      showAlert(els.infoBox, `Rendering PDF page ${p + 1}/${pages}…`);
      setHidden(els.errorBox, true);
      if (p > 0) pdf.addPage();
      const canvas = await window.html2canvas(doc, {
        backgroundColor: "#0a0e17",
        scale: 2,
        useCORS: true,
        logging: false,
        x: 0,
        y: p * pageHeightPx,
        width: pageWidthPx,
        height: pageHeightPx,
        windowWidth: pageWidthPx,
        windowHeight: pageHeightPx,
        scrollX: -window.scrollX,
        scrollY: -window.scrollY,
      });

      const imgData = canvas.toDataURL("image/png", 1.0);
      pdf.addImage(imgData, "PNG", 0, 0, pageWidthPt, pageHeightPt, undefined, "FAST");
    }

    pdf.save(`${exportFileBase(job)}.pdf`);
  } finally {
    els.exportMount.innerHTML = "";
  }
}

async function exportReportPng() {
  ensureExportLibs();
  const job = getExportJobOrThrow();

  if (!els.exportMount) throw new Error("Export mount is missing in the page.");
  els.exportMount.innerHTML = "";
  const doc = buildExportDocument(job);
  els.exportMount.appendChild(doc);

  try {
    await waitForExportLayout();

    const rect = doc.getBoundingClientRect();
    const pageWidthPx = Math.max(1, Math.round(rect.width));
    const pageHeightPx = Math.max(1, Math.round(pageWidthPx * (297 / 210)));
    const totalHeightPx = Math.max(pageHeightPx, Math.round(doc.scrollHeight));
    const pages = Math.max(1, Math.ceil(totalHeightPx / pageHeightPx));

    if (pages > 6) {
      const ok = window.confirm(
        `This report is ${pages} pages long. Exporting a single PNG may be very large and could slow down your browser.\n\nPress OK to continue, or Cancel to export as PDF instead.`,
      );
      if (!ok) return;
    }

    const canvas = await window.html2canvas(doc, {
      backgroundColor: "#0a0e17",
      scale: 2,
      useCORS: true,
      logging: false,
      scrollX: -window.scrollX,
      scrollY: -window.scrollY,
      windowWidth: pageWidthPx,
      windowHeight: totalHeightPx,
    });

    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Failed to render PNG."))),
        "image/png",
        1.0,
      );
    });

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${exportFileBase(job)}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } finally {
    els.exportMount.innerHTML = "";
  }
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
  if (els.exportDropdown && !els.exportDropdown.contains(e.target)) closeExportMenu();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeLangMenu();
    closeExportMenu();
  }
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

function formatTimeAgo(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  
  const now = new Date();
  const diffMs = now - d;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString();
}

function extractDomain(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function renderHistory(items) {
  if (!els.historyList) return;
  els.historyList.innerHTML = "";
  
  // Clear search input when re-rendering
  if (els.historySearch) {
    els.historySearch.value = "";
  }
  
  if (!items || items.length === 0) {
    const empty = document.createElement("div");
    empty.className = "history-empty";
    empty.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
        <circle cx="8.5" cy="8.5" r="1.5"/>
        <polyline points="21 15 16 10 5 21"/>
      </svg>
      <p>No analyses yet. Start by analyzing a video!</p>
    `;
    els.historyList.appendChild(empty);
    return;
  }

  items.forEach((item, index) => {
    const card = document.createElement("div");
    card.className = "history-item";
    card.style.animationDelay = `${index * 0.04}s`;
    card.dataset.title = (item.video_title || "").toLowerCase();
    card.dataset.url = (item.url || "").toLowerCase();

    // Thumbnail section
    const thumbnail = document.createElement("div");
    thumbnail.className = "history-thumbnail";
    
    if (item.video_thumbnail) {
      thumbnail.classList.add("has-image");
      thumbnail.style.setProperty("--thumb-url", `url("${item.video_thumbnail}")`);
      const img = document.createElement("img");
      img.src = item.video_thumbnail;
      img.alt = item.video_title || "Video thumbnail";
      img.loading = "lazy";
      img.onerror = () => {
        img.style.display = "none";
        const placeholder = document.createElement("div");
        placeholder.className = "history-thumbnail-placeholder";
        placeholder.innerHTML = `
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/>
            <line x1="7" y1="2" x2="7" y2="22"/>
            <line x1="17" y1="2" x2="17" y2="22"/>
            <line x1="2" y1="12" x2="22" y2="12"/>
            <line x1="2" y1="7" x2="7" y2="7"/>
            <line x1="2" y1="17" x2="7" y2="17"/>
            <line x1="17" y1="17" x2="22" y2="17"/>
            <line x1="17" y1="7" x2="22" y2="7"/>
          </svg>
        `;
        thumbnail.appendChild(placeholder);
      };
      thumbnail.appendChild(img);
    } else {
      const placeholder = document.createElement("div");
      placeholder.className = "history-thumbnail-placeholder";
      placeholder.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/>
          <line x1="7" y1="2" x2="7" y2="22"/>
          <line x1="17" y1="2" x2="17" y2="22"/>
          <line x1="2" y1="12" x2="22" y2="12"/>
          <line x1="2" y1="7" x2="7" y2="7"/>
          <line x1="2" y1="17" x2="7" y2="17"/>
          <line x1="17" y1="17" x2="22" y2="17"/>
          <line x1="17" y1="7" x2="22" y2="7"/>
        </svg>
      `;
      thumbnail.appendChild(placeholder);
    }

    // Score overlay on thumbnail
    const score = typeof item.overall_score === "number" ? item.overall_score : null;
    if (score !== null) {
      const scoreOverlay = document.createElement("div");
      scoreOverlay.className = "history-score-overlay";
      scoreOverlay.style.color = scoreColor(score);
      scoreOverlay.textContent = `${score}%`;
      thumbnail.appendChild(scoreOverlay);
    }

    // Content section
    const content = document.createElement("div");
    content.className = "history-content";

    const title = document.createElement("div");
    title.className = "history-title";
    title.textContent = item.video_title || extractDomain(item.url) || "Untitled";
    title.title = item.video_title || item.url || "";

    const urlEl = document.createElement("div");
    urlEl.className = "history-url";
    urlEl.textContent = item.url || "";
    urlEl.title = item.url || "";

    // Footer with badges and open button
    const footer = document.createElement("div");
    footer.className = "history-footer";

    const badges = document.createElement("div");
    badges.className = "history-badges";

    // Verdict badge (if available)
    if (item.overall_verdict) {
      const verdictBadge = document.createElement("span");
      const verdictClass = item.overall_verdict.toLowerCase().replace(/_/g, "_");
      verdictBadge.className = `badge badge-verdict badge-verdict_${verdictClass}`;
      verdictBadge.textContent = humanizeEnum(item.overall_verdict);
      badges.appendChild(verdictBadge);
    }

    const langBadge = document.createElement("span");
    langBadge.className = "badge";
    langBadge.textContent = (item.output_language || "ar").toUpperCase();
    badges.appendChild(langBadge);

    const timeBadge = document.createElement("span");
    timeBadge.className = "badge";
    timeBadge.textContent = formatTimeAgo(item.updated_at);
    badges.appendChild(timeBadge);

    const actions = document.createElement("div");
    actions.className = "history-actions-inline";

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "history-delete-btn";
    deleteBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="3 6 5 6 21 6"/>
        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
        <path d="M10 11v6"/>
        <path d="M14 11v6"/>
        <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
      </svg>
    `;
    deleteBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm("Delete this history item? This cannot be undone.")) return;
      try {
        deleteBtn.disabled = true;
        await deleteHistoryItem(item.id);
        await loadHistory();
      } catch (err) {
        showAlert(els.errorBox, err?.message || String(err));
      } finally {
        deleteBtn.disabled = false;
      }
    });

    const openBtn = document.createElement("button");
    openBtn.type = "button";
    openBtn.className = "history-open-btn";
    openBtn.textContent = "Open";
    openBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      try {
        openBtn.disabled = true;
        await loadJobPage(item.id, { navigate: true });
        if (els.forceRun) els.forceRun.checked = false;
        setHidden(els.historyCard, true);
      } catch (err) {
        showAlert(els.errorBox, err?.message || String(err));
      } finally {
        openBtn.disabled = false;
      }
    });

    actions.appendChild(deleteBtn);
    actions.appendChild(openBtn);

    footer.appendChild(badges);
    footer.appendChild(actions);

    content.appendChild(title);
    content.appendChild(urlEl);
    content.appendChild(footer);

    card.appendChild(thumbnail);
    card.appendChild(content);

    // Click entire card to open
    card.addEventListener("click", async () => {
      try {
        await loadJobPage(item.id, { navigate: true });
        if (els.forceRun) els.forceRun.checked = false;
        setHidden(els.historyCard, true);
      } catch (err) {
        showAlert(els.errorBox, err?.message || String(err));
      }
    });

    els.historyList.appendChild(card);
  });
}

function filterHistory(query) {
  if (!els.historyList) return;
  const q = (query || "").toLowerCase().trim();
  const items = els.historyList.querySelectorAll(".history-item");
  
  items.forEach((item) => {
    const title = item.dataset.title || "";
    const url = item.dataset.url || "";
    const matches = !q || title.includes(q) || url.includes(q);
    item.classList.toggle("hidden", !matches);
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

async function deleteHistoryItem(jobId) {
  const id = encodeURIComponent(String(jobId || ""));
  const res = await fetch(`/api/history/${id}`, { method: "DELETE", credentials: "same-origin" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.detail || `Failed to delete history (${res.status})`);
  }
}

async function deleteAllHistory() {
  const res = await fetch("/api/history?all=true", { method: "DELETE", credentials: "same-origin" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.detail || `Failed to delete history (${res.status})`);
  }
}

// ============================================
// Analysis
// ============================================

async function loadJobPage(jobId, { navigate = true, replace = false } = {}) {
  if (!jobId) return;
  cancelPolling();
  currentJobId = jobId;

  if (navigate) navigateToJob(jobId, { replace });

  // Ensure UI is visible even when arriving from a share link.
  setHidden(els.statusCard, false);
  setHidden(els.resultCard, true);
  setHidden(els.errorBox, true);
  setHidden(els.infoBox, true);
  resetThoughtSummaries();

  if (els.statusText) els.statusText.textContent = "Loading...";
  lastKnownStatus = null;
  setProgress(0);

  try {
    const job = await getJson(`/api/jobs/${jobId}`);
    currentJobId = job.id || jobId;
    lastSubmittedUrl = job.url || lastSubmittedUrl;
    if (els.url) els.url.value = job.url || "";
    setSelectedLanguageByCode(job.output_language || selectedLanguage.code);

    lastKnownStatus = job.status;
    if (els.statusText) els.statusText.textContent = humanizeEnum(job.status);
    setProgress(job.progress);
    updateThoughtSummaries(job, jobId);

    if (job.status === "failed") {
      showAlert(els.errorBox, job.error || "Unknown error occurred.");
      return;
    }

    if (job.status === "completed") {
      renderResult(job);
      return;
    }

    await pollJob(jobId);
  } catch (e) {
    showAlert(els.errorBox, e?.message || String(e));
  }
}

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
  resetThoughtSummaries();
  progressBoxCollapsed = false;
  userScrolledUp = false;
  els.statusCard?.scrollIntoView({ behavior: "smooth", block: "start" });
  
  if (els.statusText) els.statusText.textContent = "Queued";
  lastKnownStatus = "queued";
  
  // Reset step states
  statusSteps.forEach(step => {
    step.classList.remove('active', 'completed');
  });
  setProgress(0);

  try {
    const { job_id, cached, is_translation } = await postJson("/api/analyze", {
      url,
      output_language: selectedLanguage.code,
      force: Boolean(force),
    });

    currentJobId = job_id;
    navigateToJob(job_id);
    
    if (cached) {
      showAlert(els.infoBox, "Loaded from cache. Enable 'Re-run' to refresh.");
    } else if (is_translation) {
      showAlert(els.infoBox, "Translating existing analysis to " + selectedLanguage.name + "...");
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

function startNewAnalysis({ navigate = true } = {}) {
  cancelPolling();
  currentJob = null;
  currentJobId = null;
  if (navigate) navigateHome();

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
  resetThoughtSummaries();
  setProgress(0);
  statusSteps.forEach(step => step.classList.remove('active', 'completed'));
  progressBoxCollapsed = false;
  userScrolledUp = false;
  
  // Reset state
  lastSubmittedUrl = "";
  currentReportLanguage = null;
  lastKnownStatus = null;
  
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

els.shareBtn?.addEventListener("click", async () => {
  const url = shareUrlForJob(currentJobId);
  try {
    await navigator.clipboard.writeText(url);
    showAlert(els.infoBox, "Share link copied.");
    setHidden(els.errorBox, true);
  } catch (e) {
    // Fallback for browsers without clipboard access (or non-HTTPS contexts)
    window.prompt("Copy this share link:", url);
  }
});

els.exportBtn?.addEventListener("click", () => {
  const isOpen = !els.exportMenu?.classList.contains("hidden");
  if (isOpen) closeExportMenu();
  else openExportMenu();
});

els.exportPdf?.addEventListener("click", async () => {
  closeExportMenu();
  setExportBusy(true, "Exporting PDF…");
  showAlert(els.infoBox, "Preparing PDF export…");
  setHidden(els.errorBox, true);
  try {
    await exportReportPdf();
    showAlert(els.infoBox, "PDF exported.");
  } catch (e) {
    reportExportError(e);
  } finally {
    setExportBusy(false);
  }
});

els.exportPng?.addEventListener("click", async () => {
  closeExportMenu();
  setExportBusy(true, "Exporting PNG…");
  showAlert(els.infoBox, "Preparing PNG export…");
  setHidden(els.errorBox, true);
  try {
    await exportReportPng();
    showAlert(els.infoBox, "PNG exported.");
  } catch (e) {
    reportExportError(e);
  } finally {
    setExportBusy(false);
  }
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

els.historyClear?.addEventListener("click", async () => {
  if (!confirm("Delete all history items? This cannot be undone.")) return;
  try {
    if (els.historyClear) els.historyClear.disabled = true;
    await deleteAllHistory();
    await loadHistory();
  } catch (err) {
    showAlert(els.errorBox, err?.message || String(err));
  } finally {
    if (els.historyClear) els.historyClear.disabled = false;
  }
});

// History search
els.historySearch?.addEventListener("input", (e) => {
  filterHistory(e.target.value);
});

els.tabClaims?.addEventListener("click", () => setDetailsTab("claims"));
els.tabSources?.addEventListener("click", () => setDetailsTab("sources"));
els.tabTranscript?.addEventListener("click", () => setDetailsTab("transcript"));

// Progress box toggle (collapse/expand)
els.progressToggle?.addEventListener("click", () => {
  collapseProgressBox(!progressBoxCollapsed);
});

// Track if user scrolled down to see older items
els.thoughtsList?.addEventListener("scroll", () => {
  const listEl = els.thoughtsList;
  // If scrollTop > 0, user has scrolled down to see older items
  // We want to stop auto-scrolling to top if user is reading
  userScrolledUp = listEl.scrollTop > 30;
});

// ============================================
// Initialize
// ============================================

// Initialize language dropdown
renderLangList("");

// Surface JS errors in the UI (helps when Chrome extensions break clicks/polling).
window.addEventListener("error", (e) => {
  reportFrontendError("Frontend error", e?.error || e?.message);
});

window.addEventListener("unhandledrejection", (e) => {
  reportFrontendError("Unhandled promise rejection", e?.reason);
});

// If arriving on a shareable run page (/r/{job_id}), load that job automatically.
(async () => {
  const jobId = getJobIdFromLocation();
  if (jobId) {
    await loadJobPage(jobId, { navigate: false, replace: true });
  }
})();

// Handle back/forward navigation between run pages and home.
window.addEventListener("popstate", () => {
  const jobId = getJobIdFromLocation();
  if (jobId) {
    loadJobPage(jobId, { navigate: false, replace: true });
  } else {
    startNewAnalysis({ navigate: false });
  }
});

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
