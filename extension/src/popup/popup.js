/**
 * VerifyAI Popup
 * Quick access to fact-checking and status
 */

import { sendToBackground, getCurrentTab, onMessage } from '../shared/messaging.js';
import { getSettings, saveSettings } from '../shared/storage.js';
import { extensionApi } from '../shared/browser-apis.js';
import {
  MESSAGE_TYPES,
  JOB_STATUSES,
  STATUS_LABELS,
  VERDICT_LABELS,
  getScoreColor,
  getVerdictColor,
  PLATFORMS,
} from '../shared/constants.js';

// DOM elements
const els = {
  notVideoPage: document.getElementById('notVideoPage'),
  videoDetected: document.getElementById('videoDetected'),
  analysisProgress: document.getElementById('analysisProgress'),
  analysisComplete: document.getElementById('analysisComplete'),
  errorState: document.getElementById('errorState'),

  platformBadge: document.getElementById('platformBadge'),
  videoTitle: document.getElementById('videoTitle'),
  factCheckBtn: document.getElementById('factCheckBtn'),

  progressStatus: document.getElementById('progressStatus'),
  progressFill: document.getElementById('progressFill'),
  progressPercent: document.getElementById('progressPercent'),
  openPanelBtn: document.getElementById('openPanelBtn'),

  scoreValue: document.getElementById('scoreValue'),
  verdictBadge: document.getElementById('verdictBadge'),
  summaryPreview: document.getElementById('summaryPreview'),
  viewResultsBtn: document.getElementById('viewResultsBtn'),
  rerunBtn: document.getElementById('rerunBtn'),

  errorMessage: document.getElementById('errorMessage'),
  retryBtn: document.getElementById('retryBtn'),

  languageSelect: document.getElementById('languageSelect'),
  historyBtn: document.getElementById('historyBtn'),
  optionsBtn: document.getElementById('optionsBtn'),
};

// State
let currentTab = null;
let currentUrl = null;
let currentPlatform = null;
let currentJobId = null;
let backendUrl = 'http://localhost:8000';

/**
 * Initialize popup
 */
async function initialize() {
  // Load settings
  const settings = await getSettings();
  backendUrl = settings.backendUrl;
  els.languageSelect.value = settings.language || 'en';

  // Set up event listeners
  setupEventListeners();

  // Set up message listener
  setupMessageListener();

  // Check current tab
  await checkCurrentTab();
}

/**
 * Set up event listeners
 */
function setupEventListeners() {
  els.factCheckBtn?.addEventListener('click', handleFactCheck);
  els.openPanelBtn?.addEventListener('click', handleOpenPanel);
  els.viewResultsBtn?.addEventListener('click', handleViewResults);
  els.rerunBtn?.addEventListener('click', handleRerun);
  els.retryBtn?.addEventListener('click', handleRetry);
  els.languageSelect?.addEventListener('change', handleLanguageChange);
  els.historyBtn?.addEventListener('click', handleHistory);
  els.optionsBtn?.addEventListener('click', handleOptions);
}

/**
 * Set up message listener
 */
function setupMessageListener() {
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
 * Check current tab for video content
 */
async function checkCurrentTab() {
  try {
    currentTab = await getCurrentTab();

    if (!currentTab?.url) {
      showNotVideoPage();
      return;
    }

    currentUrl = currentTab.url;

    // Check if it's a supported video page
    currentPlatform = detectPlatformFromUrl(currentUrl);

    if (!currentPlatform) {
      showNotVideoPage();
      return;
    }

    // Check for cached result
    const cached = await sendToBackground(MESSAGE_TYPES.GET_CACHED_RESULT, {
      url: currentUrl,
    });

    if (cached) {
      if (cached.status === JOB_STATUSES.COMPLETED && cached.report) {
        currentJobId = cached.id;
        showComplete(cached.report);
        return;
      } else if (cached.status !== JOB_STATUSES.FAILED) {
        currentJobId = cached.id;
        showProgress(cached);
        return;
      }
    }

    // Show video detected state
    showVideoDetected();
  } catch (error) {
    console.error('[VerifyAI] Error checking current tab:', error);
    showNotVideoPage();
  }
}

/**
 * Detect platform from URL
 */
function detectPlatformFromUrl(url) {
  for (const platform of Object.values(PLATFORMS)) {
    for (const pattern of platform.patterns) {
      if (pattern.test(url)) {
        return platform;
      }
    }
  }
  return null;
}

/**
 * Show not a video page state
 */
function showNotVideoPage() {
  hideAll();
  els.notVideoPage.classList.remove('hidden');
}

/**
 * Show video detected state
 */
function showVideoDetected() {
  hideAll();
  els.videoDetected.classList.remove('hidden');

  if (currentPlatform) {
    els.platformBadge.textContent = currentPlatform.name;
  }

  // Try to get video title from tab
  els.videoTitle.textContent = currentTab?.title || 'Video detected';
}

/**
 * Show progress state
 */
function showProgress(job) {
  hideAll();
  els.analysisProgress.classList.remove('hidden');

  updateProgress(job);
}

/**
 * Update progress display
 */
function updateProgress(job) {
  const progress = job.progress || 0;
  els.progressStatus.textContent = STATUS_LABELS[job.status] || job.status;
  els.progressFill.style.width = `${progress}%`;
  els.progressPercent.textContent = `${progress}%`;
}

/**
 * Show complete state
 */
function showComplete(report) {
  hideAll();
  els.analysisComplete.classList.remove('hidden');

  const score = report.overall_score;
  els.scoreValue.textContent = score;
  els.scoreValue.parentElement.style.color = getScoreColor(score);

  els.verdictBadge.textContent = VERDICT_LABELS[report.overall_verdict] || report.overall_verdict;
  els.verdictBadge.style.backgroundColor = getVerdictColor(report.overall_verdict);

  // Summary preview
  const summary = report.summary || '';
  els.summaryPreview.textContent = summary.length > 100 ? summary.slice(0, 100) + '...' : summary;
}

/**
 * Show error state
 */
function showError(error) {
  hideAll();
  els.errorState.classList.remove('hidden');
  els.errorMessage.textContent = error || 'An error occurred';
}

/**
 * Hide all sections
 */
function hideAll() {
  els.notVideoPage.classList.add('hidden');
  els.videoDetected.classList.add('hidden');
  els.analysisProgress.classList.add('hidden');
  els.analysisComplete.classList.add('hidden');
  els.errorState.classList.add('hidden');
}

/**
 * Handle fact check button click
 */
async function handleFactCheck() {
  if (!currentUrl) return;

  els.factCheckBtn.disabled = true;

  try {
    const language = els.languageSelect.value;

    const response = await sendToBackground(MESSAGE_TYPES.START_FACT_CHECK, {
      url: currentUrl,
      language,
      tabId: currentTab?.id,
    });

    currentJobId = response.job_id;

    if (response.cached && response.job?.status === JOB_STATUSES.COMPLETED) {
      showComplete(response.job.report);
    } else {
      showProgress({ status: 'queued', progress: 0 });
    }
  } catch (error) {
    console.error('[VerifyAI] Error starting fact check:', error);
    showError(error.message);
  } finally {
    els.factCheckBtn.disabled = false;
  }
}

/**
 * Handle job update
 */
function handleJobUpdate(job) {
  if (job) {
    updateProgress(job);
    if (!els.analysisProgress.classList.contains('hidden')) {
      // Already showing progress, just update
    } else {
      showProgress(job);
    }
  }
}

/**
 * Handle job completed
 */
function handleJobCompleted(job) {
  if (job?.report) {
    showComplete(job.report);
  }
}

/**
 * Handle job failed
 */
function handleJobFailed(error) {
  showError(error || 'Analysis failed');
}

/**
 * Handle open panel button
 */
async function handleOpenPanel() {
  await sendToBackground(MESSAGE_TYPES.OPEN_SIDE_PANEL, {
    tabId: currentTab?.id,
  });
  window.close();
}

/**
 * Handle view results button
 */
async function handleViewResults() {
  if (currentJobId) {
    const reportUrl = `${backendUrl}/r/${currentJobId}`;
    if (extensionApi?.tabs?.create) {
      extensionApi.tabs.create({ url: reportUrl });
    } else {
      window.open(reportUrl, '_blank');
    }
  } else {
    await sendToBackground(MESSAGE_TYPES.OPEN_SIDE_PANEL, {
      tabId: currentTab?.id,
    });
  }
  window.close();
}

/**
 * Handle rerun button
 */
async function handleRerun() {
  if (!currentUrl) return;

  try {
    const language = els.languageSelect.value;

    const response = await sendToBackground(MESSAGE_TYPES.START_FACT_CHECK, {
      url: currentUrl,
      language,
      force: true,
      tabId: currentTab?.id,
    });

    currentJobId = response.job_id;
    showProgress({ status: 'queued', progress: 0 });
  } catch (error) {
    console.error('[VerifyAI] Error rerunning analysis:', error);
    showError(error.message);
  }
}

/**
 * Handle retry button
 */
function handleRetry() {
  checkCurrentTab();
}

/**
 * Handle language change
 */
async function handleLanguageChange() {
  const language = els.languageSelect.value;
  await saveSettings({ language });
}

/**
 * Handle history button
 */
function handleHistory() {
  // Open the web app history page
  if (extensionApi?.tabs?.create) {
    extensionApi.tabs.create({ url: backendUrl });
  } else {
    window.open(backendUrl, '_blank');
  }
  window.close();
}

/**
 * Handle options button
 */
function handleOptions() {
  if (extensionApi?.runtime?.openOptionsPage) {
    extensionApi.runtime.openOptionsPage();
  } else {
    window.open('src/options/options.html', '_blank');
  }
  window.close();
}

// Initialize on load
initialize();
