const els = {
  url: document.getElementById("url"),
  run: document.getElementById("run"),
  statusCard: document.getElementById("statusCard"),
  statusText: document.getElementById("statusText"),
  progressPill: document.getElementById("progressPill"),
  progressBar: document.getElementById("progressBar"),
  errorBox: document.getElementById("errorBox"),
  resultCard: document.getElementById("resultCard"),
  reportSummary: document.getElementById("reportSummary"),
  whatsRight: document.getElementById("whatsRight"),
  whatsWrong: document.getElementById("whatsWrong"),
  dangerList: document.getElementById("dangerList"),
  sourcesList: document.getElementById("sourcesList"),
  claimsJson: document.getElementById("claimsJson"),
  transcript: document.getElementById("transcript"),
};

function setHidden(el, hidden) {
  if (hidden) el.classList.add("hidden");
  else el.classList.remove("hidden");
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

function renderResult(job) {
  setHidden(els.resultCard, false);
  els.reportSummary.textContent = job.report?.summary || "";
  setList(els.whatsRight, job.report?.whats_right || []);
  setList(els.whatsWrong, job.report?.whats_wrong || []);

  const dangers = (job.report?.danger || []).map((d) => {
    const sev = typeof d.severity === "number" ? ` (severity ${d.severity}/5)` : "";
    return `${d.category}${sev}: ${d.description}`;
  });
  setList(els.dangerList, dangers);

  const sources = (job.report?.sources_used || []).map((s) => {
    const pub = s.publisher ? `${s.publisher} — ` : "";
    return `${pub}${s.title} (${s.url})`;
  });
  setList(els.sourcesList, sources);

  els.claimsJson.textContent = JSON.stringify(job.report?.claims || [], null, 2);
  els.transcript.textContent = job.transcript || "";
}

els.run.addEventListener("click", async () => {
  const url = els.url.value.trim();
  if (!url) return;

  els.run.disabled = true;
  setHidden(els.statusCard, false);
  setHidden(els.resultCard, true);
  setHidden(els.errorBox, true);
  els.statusText.textContent = "queued";
  setProgress(0);

  try {
    const { job_id } = await postJson("/api/analyze", { url });
    await pollJob(job_id);
  } catch (e) {
    setHidden(els.errorBox, false);
    els.errorBox.textContent = e?.message || String(e);
  } finally {
    els.run.disabled = false;
  }
});
