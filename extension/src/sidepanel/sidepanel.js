/**
 * VerifyAI Side Panel
 * Displays detailed fact-check results
 */

import { onMessage, sendToBackground, getCurrentTab } from '../shared/messaging.js';
import { getSettings } from '../shared/storage.js';
import {
  MESSAGE_TYPES,
  JOB_STATUSES,
  STATUS_LABELS,
  VERDICT_LABELS,
  CLAIM_VERDICT_LABELS,
  getScoreColor,
  getVerdictColor,
  RTL_LANGUAGES,
} from '../shared/constants.js';

// DOM elements
const els = {
  emptySection: document.getElementById('emptySection'),
  statusSection: document.getElementById('statusSection'),
  resultsSection: document.getElementById('resultsSection'),
  errorSection: document.getElementById('errorSection'),

  statusText: document.getElementById('statusText'),
  progressFill: document.getElementById('progressFill'),
  progressPercent: document.getElementById('progressPercent'),
  thoughtsContainer: document.getElementById('thoughtsContainer'),
  thoughtsList: document.getElementById('thoughtsList'),
  thoughtsCount: document.getElementById('thoughtsCount'),

  scoreRing: document.getElementById('scoreRing'),
  scoreCircle: document.getElementById('scoreCircle'),
  scoreNumber: document.getElementById('scoreNumber'),
  verdictBadge: document.getElementById('verdictBadge'),
  summaryText: document.getElementById('summaryText'),

  whatsRight: document.getElementById('whatsRight'),
  whatsWrong: document.getElementById('whatsWrong'),
  dangerSection: document.getElementById('dangerSection'),
  dangerList: document.getElementById('dangerList'),
  claimsList: document.getElementById('claimsList'),
  sourcesList: document.getElementById('sourcesList'),

  shareBtn: document.getElementById('shareBtn'),
  viewFullBtn: document.getElementById('viewFullBtn'),
  refreshBtn: document.getElementById('refreshBtn'),
  settingsBtn: document.getElementById('settingsBtn'),
  retryBtn: document.getElementById('retryBtn'),
  errorText: document.getElementById('errorText'),
};

// Current state
let currentJob = null;
let currentJobId = null;
let backendUrl = 'http://localhost:8000';

/**
 * Initialize the side panel
 */
async function initialize() {
  console.log('[VerifyAI] Side panel initializing...');

  // Load settings
  const settings = await getSettings();
  backendUrl = settings.backendUrl;

  // Set up message listeners
  setupMessageListeners();

  // Set up button handlers
  setupButtonHandlers();

  // Check for active job
  await checkForActiveJob();

  console.log('[VerifyAI] Side panel initialized');
}

/**
 * Set up message listeners
 */
function setupMessageListeners() {
  onMessage((message) => {
    switch (message.type) {
      case MESSAGE_TYPES.JOB_UPDATE:
        handleJobUpdate(message.job);
        break;
      case MESSAGE_TYPES.JOB_COMPLETED:
        handleJobCompleted(message.job);
        break;
      case MESSAGE_TYPES.JOB_FAILED:
        handleJobFailed(message.error);
        break;
    }
  });
}

/**
 * Set up button handlers
 */
function setupButtonHandlers() {
  els.shareBtn?.addEventListener('click', handleShare);
  els.viewFullBtn?.addEventListener('click', handleViewFull);
  els.refreshBtn?.addEventListener('click', handleRefresh);
  els.settingsBtn?.addEventListener('click', handleSettings);
  els.retryBtn?.addEventListener('click', handleRetry);
}

/**
 * Check for active job on current tab
 */
async function checkForActiveJob() {
  try {
    const tab = await getCurrentTab();
    if (!tab?.id) return;

    // Get any cached result for current URL
    if (tab.url) {
      const cached = await sendToBackground(MESSAGE_TYPES.GET_CACHED_RESULT, {
        url: tab.url,
      });

      if (cached && cached.status === JOB_STATUSES.COMPLETED) {
        currentJob = cached;
        currentJobId = cached.id;
        showResults(cached.report, cached.output_language);
        return;
      }
    }

    // Show empty state
    showEmpty();
  } catch (error) {
    console.error('[VerifyAI] Error checking for active job:', error);
    showEmpty();
  }
}

/**
 * Handle job update
 */
function handleJobUpdate(job) {
  if (!job) return;

  currentJob = job;
  currentJobId = job.id;

  if (job.status === JOB_STATUSES.COMPLETED && job.report) {
    showResults(job.report, job.output_language);
  } else if (job.status === JOB_STATUSES.FAILED) {
    showError(job.error || 'Analysis failed');
  } else {
    showStatus(job);
  }
}

/**
 * Handle job completed
 */
function handleJobCompleted(job) {
  if (!job) return;

  currentJob = job;
  currentJobId = job.id;

  showResults(job.report, job.output_language);
}

/**
 * Handle job failed
 */
function handleJobFailed(error) {
  showError(error || 'Analysis failed');
}

/**
 * Show empty state
 */
function showEmpty() {
  els.emptySection.classList.remove('hidden');
  els.statusSection.classList.add('hidden');
  els.resultsSection.classList.add('hidden');
  els.errorSection.classList.add('hidden');
}

/**
 * Show status/progress
 */
function showStatus(job) {
  els.emptySection.classList.add('hidden');
  els.statusSection.classList.remove('hidden');
  els.resultsSection.classList.add('hidden');
  els.errorSection.classList.add('hidden');

  // Update status text
  els.statusText.textContent = STATUS_LABELS[job.status] || job.status;

  // Update progress bar
  const progress = job.progress || 0;
  els.progressFill.style.width = `${progress}%`;
  els.progressPercent.textContent = `${progress}%`;

  // Update thoughts
  if (job.thought_summaries?.length > 0) {
    els.thoughtsContainer.classList.remove('hidden');
    els.thoughtsCount.textContent = job.thought_summaries.length;

    // Show last 5 thoughts
    const recentThoughts = job.thought_summaries.slice(-5);
    els.thoughtsList.innerHTML = recentThoughts
      .map((thought, i) => `
        <div class="thought-item ${i === recentThoughts.length - 1 ? 'latest' : ''}">
          ${escapeHtml(thought)}
        </div>
      `)
      .join('');

    // Scroll to latest
    els.thoughtsList.scrollTop = els.thoughtsList.scrollHeight;
  }
}

/**
 * Show results
 */
function showResults(report, language) {
  if (!report) {
    showEmpty();
    return;
  }

  els.emptySection.classList.add('hidden');
  els.statusSection.classList.add('hidden');
  els.resultsSection.classList.remove('hidden');
  els.errorSection.classList.add('hidden');

  // Set text direction based on language
  const isRtl = RTL_LANGUAGES.has(language?.toLowerCase());
  els.resultsSection.setAttribute('dir', isRtl ? 'rtl' : 'ltr');

  // Score
  const score = report.overall_score;
  const scoreColor = getScoreColor(score);

  els.scoreNumber.textContent = score;
  els.scoreRing.style.setProperty('--score-color', scoreColor);

  // Animate score circle
  const circumference = 2 * Math.PI * 45;
  const offset = circumference - (score / 100) * circumference;
  els.scoreCircle.style.strokeDasharray = circumference;
  els.scoreCircle.style.strokeDashoffset = offset;
  els.scoreCircle.style.stroke = scoreColor;

  // Verdict
  const verdict = report.overall_verdict;
  els.verdictBadge.textContent = VERDICT_LABELS[verdict] || verdict;
  els.verdictBadge.style.backgroundColor = getVerdictColor(verdict);

  // Summary
  els.summaryText.textContent = report.summary || '';

  // What's right
  renderList(els.whatsRight, report.whats_right);

  // What's wrong
  renderList(els.whatsWrong, report.whats_wrong);

  // Danger warnings
  if (report.danger?.length > 0) {
    els.dangerSection.classList.remove('hidden');
    renderDangerList(els.dangerList, report.danger);
  } else {
    els.dangerSection.classList.add('hidden');
  }

  // Claims
  renderClaims(els.claimsList, report.claims);

  // Sources
  renderSources(els.sourcesList, report.sources_used);
}

/**
 * Show error state
 */
function showError(error) {
  els.emptySection.classList.add('hidden');
  els.statusSection.classList.add('hidden');
  els.resultsSection.classList.add('hidden');
  els.errorSection.classList.remove('hidden');

  els.errorText.textContent = error;
}

/**
 * Render a simple list
 */
function renderList(container, items) {
  if (!items?.length) {
    container.innerHTML = '<li class="empty-item">None</li>';
    return;
  }

  container.innerHTML = items
    .map(item => `<li>${escapeHtml(item)}</li>`)
    .join('');
}

/**
 * Render danger list
 */
function renderDangerList(container, items) {
  container.innerHTML = items
    .map(item => `
      <li class="danger-item severity-${item.severity}">
        <div class="danger-category">${formatCategory(item.category)}</div>
        <div class="danger-description">${escapeHtml(item.description)}</div>
        ${item.mitigation ? `<div class="danger-mitigation">${escapeHtml(item.mitigation)}</div>` : ''}
      </li>
    `)
    .join('');
}

/**
 * Render claims list
 */
function renderClaims(container, claims) {
  if (!claims?.length) {
    container.innerHTML = '<p class="empty-claims">No claims analyzed</p>';
    return;
  }

  container.innerHTML = claims
    .map((claim, i) => `
      <div class="claim-card" data-verdict="${claim.verdict}">
        <div class="claim-header">
          <span class="claim-verdict verdict-${claim.verdict}">
            ${CLAIM_VERDICT_LABELS[claim.verdict] || claim.verdict}
          </span>
          <div class="claim-metrics">
            <span class="claim-weight" title="Importance">W: ${claim.weight}</span>
            <span class="claim-confidence" title="Confidence">C: ${claim.confidence}</span>
          </div>
        </div>
        <p class="claim-text">${escapeHtml(claim.claim)}</p>
        <p class="claim-explanation">${escapeHtml(claim.explanation)}</p>
        ${claim.correction ? `
          <div class="claim-correction">
            <strong>Correction:</strong> ${escapeHtml(claim.correction)}
          </div>
        ` : ''}
        ${claim.sources?.length ? `
          <div class="claim-sources">
            <strong>Sources:</strong>
            ${claim.sources.map(s => `
              <a href="${escapeHtml(s.url)}" target="_blank" rel="noopener">${escapeHtml(s.title || s.url)}</a>
            `).join(', ')}
          </div>
        ` : ''}
      </div>
    `)
    .join('');
}

/**
 * Render sources list
 */
function renderSources(container, sources) {
  if (!sources?.length) {
    container.innerHTML = '<li class="empty-item">No sources</li>';
    return;
  }

  container.innerHTML = sources
    .map(source => `
      <li class="source-item">
        <a href="${escapeHtml(source.url)}" target="_blank" rel="noopener">
          ${escapeHtml(source.title || source.url)}
        </a>
        ${source.publisher ? `<span class="source-publisher">${escapeHtml(source.publisher)}</span>` : ''}
      </li>
    `)
    .join('');
}

/**
 * Handle share button
 */
async function handleShare() {
  if (!currentJobId) return;

  const shareUrl = `${backendUrl}/r/${currentJobId}`;

  try {
    await navigator.clipboard.writeText(shareUrl);
    els.shareBtn.textContent = 'Copied!';
    setTimeout(() => {
      els.shareBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="18" cy="5" r="3"/>
          <circle cx="6" cy="12" r="3"/>
          <circle cx="18" cy="19" r="3"/>
          <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
          <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
        </svg>
        Share Report
      `;
    }, 2000);
  } catch (error) {
    // Fallback: open share URL in new tab
    window.open(shareUrl, '_blank');
  }
}

/**
 * Handle view full report button
 */
function handleViewFull() {
  if (!currentJobId) return;

  const reportUrl = `${backendUrl}/r/${currentJobId}`;
  window.open(reportUrl, '_blank');
}

/**
 * Handle refresh button
 */
async function handleRefresh() {
  await checkForActiveJob();
}

/**
 * Handle settings button
 */
function handleSettings() {
  chrome.runtime.openOptionsPage();
}

/**
 * Handle retry button
 */
async function handleRetry() {
  // TODO: Re-trigger analysis for current URL
  showEmpty();
}

/**
 * Format danger category
 */
function formatCategory(category) {
  return category
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Initialize on load
initialize();
