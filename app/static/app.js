const els = {
  url: document.getElementById("url"),
  run: document.getElementById("run"),
  forceRun: document.getElementById("forceRun"),

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

function setHidden(el, hidden) {
  if (hidden) el.classList.add("hidden");
  else el.classList.remove("hidden");
}

function setText(el, text) {
  if (!el) return;
  el.textContent = text ?? "";
}

function isRtlLanguage(code) {
  return RTL_LANGS.has(String(code || "").toLowerCase());
}

function applyOutputDirection() {
  const lang = String(currentReportLanguage || selectedLanguage?.code || "en").toLowerCase();
  const dir = isRtlLanguage(lang) ? "rtl" : "ltr";

  // AI-generated (human-readable) fields: set explicit direction by chosen output language.
  const outputEls = [els.reportSummary, els.whatsRight, els.whatsWrong, els.dangerList, els.claimsList];
  for (const el of outputEls) {
    if (!el) continue;
    el.setAttribute("dir", dir);
    el.setAttribute("lang", lang);
  }

  // Mixed/structured blocks: keep readable in any locale.
  if (els.sourcesList) els.sourcesList.setAttribute("dir", "auto");
  if (els.transcript) els.transcript.setAttribute("dir", "auto");
}

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
      t.tab.classList.toggle("tabBtnActive", isActive);
      t.tab.setAttribute("aria-selected", isActive ? "true" : "false");
      t.tab.tabIndex = isActive ? 0 : -1;
    }
    if (t.panel) setHidden(t.panel, !isActive);
  }
}

function setProgress(pct) {
  els.progressPill.textContent = `${pct}%`;
  els.progressBar.style.width = `${pct}%`;
}

function setList(ul, items) {
  ul.innerHTML = "";
  for (const item of items || []) {
    const li = document.createElement("li");
    li.textContent = item;
    ul.appendChild(li);
  }
}

function setDangerList(ul, items) {
  ul.innerHTML = "";
  for (const d of items || []) {
    const li = document.createElement("li");

    const head = document.createElement("bdi");
    head.setAttribute("dir", "ltr");
    const sev =
      typeof d.severity === "number" && Number.isFinite(d.severity) ? ` (severity ${d.severity}/5)` : "";
    head.textContent = `${d.category || "other"}${sev}`;

    const sep = document.createElement("span");
    sep.textContent = ": ";

    const body = document.createElement("span");
    body.textContent = d.description || "";

    li.appendChild(head);
    li.appendChild(sep);
    li.appendChild(body);
    ul.appendChild(li);
  }
}

function setSources(ul, sources) {
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

function verdictLabel(verdict) {
  return humanizeEnum(verdict || "");
}

function verdictClass(verdict) {
  switch (String(verdict || "")) {
    case "supported":
      return "supported";
    case "contradicted":
      return "contradicted";
    case "mixed":
      return "mixed";
    case "unverifiable":
      return "unverifiable";
    case "not_a_factual_claim":
      return "notclaim";
    default:
      return "unverifiable";
  }
}

function verdictColor(verdict) {
  switch (String(verdict || "")) {
    case "supported":
      return "#2ee59d";
    case "contradicted":
      return "var(--danger)";
    case "mixed":
      return "#ffd24a";
    case "unverifiable":
    case "not_a_factual_claim":
    default:
      return "var(--muted)";
  }
}

function metricRow({ label, valueText, percent, color }) {
  const wrap = document.createElement("div");
  wrap.className = "metric";

  const head = document.createElement("div");
  head.className = "metricHead";

  const l = document.createElement("div");
  l.className = "metricLabel";
  l.textContent = label;

  const v = document.createElement("div");
  v.className = "metricValue";
  const bdi = document.createElement("bdi");
  bdi.setAttribute("dir", "ltr");
  bdi.textContent = valueText;
  v.appendChild(bdi);

  head.appendChild(l);
  head.appendChild(v);

  const bar = document.createElement("div");
  bar.className = "metricBar";
  const fill = document.createElement("div");
  fill.className = "metricFill";
  fill.style.width = `${Math.max(0, Math.min(100, Number(percent) || 0))}%`;
  fill.style.background = color;
  bar.appendChild(fill);

  wrap.appendChild(head);
  wrap.appendChild(bar);
  return wrap;
}

function renderClaimSources(sources) {
  const ul = document.createElement("ul");
  ul.className = "claimSources";
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
    empty.className = "muted small";
    empty.textContent = "No claims extracted.";
    els.claimsList.appendChild(empty);
    return;
  }

  for (const c of list) {
    const details = document.createElement("details");
    details.className = `claimCard claimCard_${verdictClass(c?.verdict)}`;

    const summary = document.createElement("summary");
    summary.className = "claimSummary";

    const sumInner = document.createElement("div");
    sumInner.className = "claimSummaryInner";

    const text = document.createElement("div");
    text.className = "claimText";
    text.textContent = c?.claim || "";

    const chips = document.createElement("div");
    chips.className = "chips";

    const verdict = document.createElement("span");
    verdict.className = `chip chipVerdict chipVerdict_${verdictClass(c?.verdict)}`;
    verdict.setAttribute("dir", "ltr");
    verdict.textContent = verdictLabel(c?.verdict) || "Unverifiable";

    const weight = Number(c?.weight ?? 0);
    const weightChip = document.createElement("span");
    weightChip.className = "chip";
    weightChip.setAttribute("dir", "ltr");
    weightChip.textContent = `Weight ${Math.max(0, Math.min(100, weight))}/100`;

    const conf = Number(c?.confidence ?? 0);
    const confChip = document.createElement("span");
    confChip.className = "chip";
    confChip.setAttribute("dir", "ltr");
    confChip.textContent = `Confidence ${Math.max(0, Math.min(100, conf))}/100`;

    chips.appendChild(verdict);
    chips.appendChild(weightChip);
    chips.appendChild(confChip);

    sumInner.appendChild(text);
    sumInner.appendChild(chips);
    summary.appendChild(sumInner);

    const body = document.createElement("div");
    body.className = "claimBody";

    body.appendChild(
      metricRow({
        label: "Centrality (weight)",
        valueText: `${Math.max(0, Math.min(100, weight))}/100`,
        percent: weight,
        color: "linear-gradient(90deg, var(--accent), rgba(0,200,255,0.9))",
      }),
    );

    body.appendChild(
      metricRow({
        label: "Evidence confidence",
        valueText: `${Math.max(0, Math.min(100, conf))}/100`,
        percent: conf,
        color: `linear-gradient(90deg, ${verdictColor(c?.verdict)}, rgba(255,255,255,0.12))`,
      }),
    );

    const explanation = document.createElement("div");
    explanation.className = "claimSection";
    const exLabel = document.createElement("div");
    exLabel.className = "sectionLabel";
    exLabel.textContent = "Explanation";
    const exText = document.createElement("div");
    exText.className = "sectionText";
    exText.textContent = c?.explanation || "";
    explanation.appendChild(exLabel);
    explanation.appendChild(exText);
    body.appendChild(explanation);

    const correctionText = (c?.correction || "").trim();
    if (correctionText) {
      const corr = document.createElement("div");
      corr.className = "callout";
      const corrLabel = document.createElement("div");
      corrLabel.className = "sectionLabel";
      corrLabel.textContent = "Correction";
      const corrBody = document.createElement("div");
      corrBody.className = "sectionText";
      corrBody.textContent = correctionText;
      corr.appendChild(corrLabel);
      corr.appendChild(corrBody);
      body.appendChild(corr);
    }

    const sources = Array.isArray(c?.sources) ? c.sources : [];
    if (sources.length) {
      const src = document.createElement("div");
      src.className = "claimSection";
      const sLabel = document.createElement("div");
      sLabel.className = "sectionLabel";
      sLabel.textContent = "Sources";
      src.appendChild(sLabel);
      src.appendChild(renderClaimSources(sources));
      body.appendChild(src);
    }

    details.appendChild(summary);
    details.appendChild(body);
    els.claimsList.appendChild(details);
  }
}

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
    els.statusText.textContent = job.status;
    setProgress(job.progress);

    if (job.status === "failed") {
      setHidden(els.errorBox, false);
      els.errorBox.textContent = job.error || "Unknown error.";
      setHidden(els.resultCard, true);
      return;
    }

    if (job.status === "completed") {
      setHidden(els.errorBox, true);
      renderResult(job);
      return;
    }

    await new Promise((r) => setTimeout(r, 2000));
  }
}

function humanizeEnum(value) {
  if (!value) return "";
  return String(value)
    .replaceAll("_", " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function scoreColor(score) {
  const s = Number(score ?? 0);
  if (s < 50) return "var(--danger)";
  if (s < 80) return "#ffd24a";
  return "#2ee59d";
}

function renderResult(job) {
  setHidden(els.resultCard, false);
  currentReportLanguage = job.output_language || currentReportLanguage || selectedLanguage.code;
  applyOutputDirection();
  setDetailsTab(activeDetailsTab || "claims");

  const score = Number(job.report?.overall_score ?? 0);
  els.scorePct.textContent = `${Math.max(0, Math.min(100, score))}%`;
  els.scoreCircle.style.setProperty("--pct", String(Math.max(0, Math.min(100, score))));
  els.scoreCircle.style.setProperty("--score-color", scoreColor(score));

  const verdict = humanizeEnum(job.report?.overall_verdict);
  els.verdictText.textContent = verdict ? `Overall: ${verdict}` : "";

  const generated = job.report?.generated_at;
  if (generated) {
    const d = new Date(generated);
    els.generatedAt.textContent = Number.isNaN(d.getTime()) ? String(generated) : d.toLocaleString();
  } else {
    els.generatedAt.textContent = "";
  }

  els.reportSummary.textContent = job.report?.summary || "";
  setList(els.whatsRight, job.report?.whats_right || []);
  setList(els.whatsWrong, job.report?.whats_wrong || []);

  setDangerList(els.dangerList, job.report?.danger || []);

  setSources(els.sourcesList, job.report?.sources_used || []);

  renderClaims(job.report?.claims || []);
  els.transcript.textContent = job.transcript || "";
}

function openLangMenu() {
  setHidden(els.langMenu, false);
  els.langSearch.value = "";
  renderLangList("");
  els.langSearch.focus();
}

function closeLangMenu() {
  setHidden(els.langMenu, true);
}

function renderLangList(filter) {
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
      els.langLabel.textContent = l.name;
      closeLangMenu();
    });
    els.langList.appendChild(btn);
  }
}

els.langButton.addEventListener("click", () => {
  const isOpen = !els.langMenu.classList.contains("hidden");
  if (isOpen) closeLangMenu();
  else openLangMenu();
});

els.langSearch.addEventListener("input", (e) => renderLangList(e.target.value));

document.addEventListener("click", (e) => {
  if (!els.langDropdown.contains(e.target)) closeLangMenu();
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

function formatWhen(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString();
}

function renderHistory(items) {
  els.historyList.innerHTML = "";
  if (!items || items.length === 0) {
    const empty = document.createElement("div");
    empty.className = "muted small";
    empty.textContent = "No analyses yet.";
    els.historyList.appendChild(empty);
    return;
  }

  for (const item of items) {
    const row = document.createElement("div");
    row.className = "historyItem";

    const score = typeof item.overall_score === "number" ? item.overall_score : null;
    const scoreEl = document.createElement("div");
    scoreEl.className = "historyScore";
    if (score !== null) {
      scoreEl.style.color = scoreColor(score);
      scoreEl.textContent = `${score}%`;
    } else {
      scoreEl.style.color = "var(--muted)";
      scoreEl.textContent = "—";
    }

    const meta = document.createElement("div");
    meta.className = "historyMeta";
    const url = document.createElement("div");
    url.className = "historyUrl";
    url.textContent = item.url || "";
    const sub = document.createElement("div");
    sub.className = "historySub";
    const b1 = document.createElement("span");
    b1.className = "badge";
    b1.textContent = (item.output_language || "ar").toUpperCase();
    const b2 = document.createElement("span");
    b2.className = "badge";
    b2.textContent = item.status || "";
    const b3 = document.createElement("span");
    b3.className = "badge";
    b3.textContent = formatWhen(item.updated_at);
    sub.appendChild(b1);
    sub.appendChild(b2);
    sub.appendChild(b3);
    meta.appendChild(url);
    meta.appendChild(sub);

    const actions = document.createElement("div");
    const openBtn = document.createElement("button");
    openBtn.type = "button";
    openBtn.className = "btn btnSecondary";
    openBtn.textContent = "Open";
    openBtn.addEventListener("click", async () => {
      const job = await getJson(`/api/jobs/${item.id}`);
      setHidden(els.errorBox, true);
      setHidden(els.statusCard, true);
      els.url.value = job.url || "";
      lastSubmittedUrl = job.url || "";
      setSelectedLanguageByCode(job.output_language || "ar");
      els.forceRun.checked = false;
      setHidden(els.infoBox, false);
      els.infoBox.textContent = "Loaded from history.";
      renderResult(job);
      setHidden(els.historyCard, true);
    });
    actions.appendChild(openBtn);

    row.appendChild(scoreEl);
    row.appendChild(meta);
    row.appendChild(actions);
    els.historyList.appendChild(row);
  }
}

async function loadHistory() {
  const items = await getJson("/api/history?limit=50");
  renderHistory(items);
}

async function runAnalysis({ force }) {
  const url = els.url.value.trim();
  if (!url) return;
  lastSubmittedUrl = url;

  els.run.disabled = true;
  setHidden(els.statusCard, false);
  setHidden(els.resultCard, true);
  setHidden(els.errorBox, true);
  setHidden(els.infoBox, true);
  els.statusText.textContent = "queued";
  setProgress(0);

  try {
    const { job_id, cached } = await postJson("/api/analyze", {
      url,
      output_language: selectedLanguage.code,
      force: Boolean(force),
    });
    if (cached) {
      setHidden(els.infoBox, false);
      els.infoBox.textContent = "Loaded saved analysis. Enable re-run to refresh.";
    }
    await pollJob(job_id);
  } catch (e) {
    setHidden(els.errorBox, false);
    els.errorBox.textContent = e?.message || String(e);
  } finally {
    els.run.disabled = false;
  }
}

els.run.addEventListener("click", async () => {
  await runAnalysis({ force: els.forceRun.checked });
});

els.rerunBtn.addEventListener("click", async () => {
  if (lastSubmittedUrl) els.url.value = lastSubmittedUrl;
  els.forceRun.checked = true;
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

if (els.historyRefresh) {
  els.historyRefresh.addEventListener("click", async () => {
    await loadHistory();
  });
}

if (els.tabClaims) els.tabClaims.addEventListener("click", () => setDetailsTab("claims"));
if (els.tabSources) els.tabSources.addEventListener("click", () => setDetailsTab("sources"));
if (els.tabTranscript) els.tabTranscript.addEventListener("click", () => setDetailsTab("transcript"));
