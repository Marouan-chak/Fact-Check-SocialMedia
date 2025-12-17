/**
 * VerifyAI Extension Service Worker
 * Handles API communication, job polling, and state management
 */

import { getApiClient } from './api-client.js';
import {
  getSettings,
  saveSettings,
  cacheResult,
  getCachedResult,
  setActiveJob,
  getActiveJob,
  removeActiveJob,
  getAllActiveJobs,
} from '../shared/storage.js';
import {
  createMessageHandler,
  sendToTab,
  broadcastToTabs,
} from '../shared/messaging.js';
import { getTab, queryTabs } from '../shared/browser-apis.js';
import {
  MESSAGE_TYPES,
  JOB_STATUSES,
  POLL_INTERVAL_MS,
  getScoreColor,
} from '../shared/constants.js';

// Active polling intervals
const pollIntervals = new Map();

// API client instance
const api = getApiClient();

/**
 * Initialize the service worker
 */
async function initialize() {
  console.log('[VerifyAI] Service worker initializing...');

  // Initialize API client with current settings
  await api.init();

  // Set up message handlers
  chrome.runtime.onMessage.addListener(
    createMessageHandler({
      [MESSAGE_TYPES.START_FACT_CHECK]: handleStartFactCheck,
      [MESSAGE_TYPES.GET_JOB_STATUS]: handleGetJobStatus,
      [MESSAGE_TYPES.GET_CACHED_RESULT]: handleGetCachedResult,
      [MESSAGE_TYPES.GET_SETTINGS]: handleGetSettings,
      [MESSAGE_TYPES.OPEN_SIDE_PANEL]: handleOpenSidePanel,
    })
  );

  // Handle tab removal
  chrome.tabs.onRemoved.addListener(handleTabRemoved);

  // Handle tab URL changes
  chrome.tabs.onUpdated.addListener(handleTabUpdated);

  // Resume any active jobs from previous session
  await resumeActiveJobs();

  console.log('[VerifyAI] Service worker initialized');
}

/**
 * Handle start fact check request
 */
async function handleStartFactCheck(data, sender) {
  const { url, language, force, tabId: requestedTabId } = data;
  let tabId = requestedTabId || sender.tab?.id;

  if (!tabId) {
    const [activeTab] = await queryTabs({ active: true, currentWindow: true });
    if (activeTab?.id) {
      tabId = activeTab.id;
    }
  }

  if (!tabId) {
    throw new Error('No tab ID available');
  }

  console.log(`[VerifyAI] Starting fact check for: ${url}`);

  try {
    // Check cache first (unless force is true)
    if (!force) {
      const cached = await getCachedResult(url);
      if (cached && cached.status === JOB_STATUSES.COMPLETED) {
        console.log('[VerifyAI] Returning cached result');
        return {
          job_id: cached.id,
          cached: true,
          is_translation: false,
          job: cached,
        };
      }
    }

    // Get settings for language
    const settings = await getSettings();
    const outputLanguage = language || settings.language || 'en';

    // Submit to API
    const response = await api.analyze(url, outputLanguage, force);

    // Track active job
    await setActiveJob(tabId, response.job_id, url);

    // Start polling
    startPolling(response.job_id, tabId);

    // Notify content script
    await sendToTab(tabId, MESSAGE_TYPES.JOB_STARTED, {
      jobId: response.job_id,
      cached: response.cached,
      isTranslation: response.is_translation,
    });

    return response;
  } catch (error) {
    console.error('[VerifyAI] Error starting fact check:', error);
    throw error;
  }
}

/**
 * Handle get job status request
 */
async function handleGetJobStatus(data) {
  const { jobId } = data;
  return api.getJob(jobId);
}

/**
 * Handle get cached result request
 */
async function handleGetCachedResult(data) {
  const { url } = data;
  return getCachedResult(url);
}

/**
 * Handle get settings request
 */
async function handleGetSettings() {
  return getSettings();
}

/**
 * Handle open side panel request
 */
async function handleOpenSidePanel(data = {}, sender) {
  let tabId = data?.tabId || sender.tab?.id;

  if (!tabId) {
    const [activeTab] = await queryTabs({ active: true, currentWindow: true });
    tabId = activeTab?.id;
  }

  if (tabId && chrome.sidePanel?.open) {
    try {
      await chrome.sidePanel.open({ tabId });
    } catch (error) {
      console.error('[VerifyAI] Error opening side panel:', error);
    }
  } else {
    console.warn('[VerifyAI] Side panel API unavailable or no tab ID to open.');
  }

  return { success: true };
}

/**
 * Start polling for a job
 */
function startPolling(jobId, tabId) {
  // Clear any existing poll for this job
  stopPolling(jobId);

  console.log(`[VerifyAI] Starting poll for job ${jobId}`);

  const poll = async () => {
    try {
      const job = await api.getJob(jobId);

      // Broadcast update to content script and side panel
      await sendToTab(tabId, MESSAGE_TYPES.JOB_UPDATE, { job });
      broadcastJobUpdate(job);

      // Update badge
      updateBadge(tabId, job);

      // Check if job is done
      if (job.status === JOB_STATUSES.COMPLETED) {
        console.log(`[VerifyAI] Job ${jobId} completed`);

        // Cache result
        await cacheResult(job.url, job);

        // Notify completion
        await sendToTab(tabId, MESSAGE_TYPES.JOB_COMPLETED, { job });

        // Stop polling
        stopPolling(jobId);

        // Remove from active jobs
        await removeActiveJob(tabId);

        // Check if should auto-open panel
        const settings = await getSettings();
        if (settings.autoOpenPanel && chrome.sidePanel) {
          try {
            await chrome.sidePanel.open({ tabId });
          } catch (e) {
            // Ignore errors
          }
        }
      } else if (job.status === JOB_STATUSES.FAILED) {
        console.log(`[VerifyAI] Job ${jobId} failed:`, job.error);

        // Notify failure
        await sendToTab(tabId, MESSAGE_TYPES.JOB_FAILED, {
          error: job.error || 'Analysis failed',
        });

        // Stop polling
        stopPolling(jobId);

        // Remove from active jobs
        await removeActiveJob(tabId);

        // Update badge to show error
        updateBadgeError(tabId);
      }
    } catch (error) {
      console.error(`[VerifyAI] Polling error for job ${jobId}:`, error);
      // Don't stop polling on transient errors, let it retry
    }
  };

  // Initial poll
  poll();

  // Set up interval
  const intervalId = setInterval(poll, POLL_INTERVAL_MS);
  pollIntervals.set(jobId, intervalId);
}

/**
 * Stop polling for a job
 */
function stopPolling(jobId) {
  const intervalId = pollIntervals.get(jobId);
  if (intervalId) {
    clearInterval(intervalId);
    pollIntervals.delete(jobId);
    console.log(`[VerifyAI] Stopped polling for job ${jobId}`);
  }
}

/**
 * Broadcast job update to all interested parties (side panel, etc.)
 */
function broadcastJobUpdate(job) {
  try {
    chrome.runtime.sendMessage(
      {
        type: MESSAGE_TYPES.JOB_UPDATE,
        job,
      },
      () => {
        // Access lastError to silence unchecked errors
        void chrome.runtime.lastError;
      },
    );
  } catch {
    // Ignore errors when no listeners
  }
}

/**
 * Update the extension badge for a tab
 */
function updateBadge(tabId, job) {
  if (job.status === JOB_STATUSES.COMPLETED && job.report) {
    const score = job.report.overall_score;
    const color = getScoreColor(score);

    chrome.action.setBadgeText({ tabId, text: `${score}` });
    chrome.action.setBadgeBackgroundColor({ tabId, color });
    chrome.action.setTitle({
      tabId,
      title: `VerifyAI - Score: ${score}%`,
    });
  } else if (job.status === JOB_STATUSES.FAILED) {
    updateBadgeError(tabId);
  } else {
    // Show progress
    const progress = job.progress || 0;
    chrome.action.setBadgeText({ tabId, text: `${progress}%` });
    chrome.action.setBadgeBackgroundColor({ tabId, color: '#2dd4bf' }); // teal
    chrome.action.setTitle({
      tabId,
      title: `VerifyAI - Analyzing... ${progress}%`,
    });
  }
}

/**
 * Update badge to show error state
 */
function updateBadgeError(tabId) {
  chrome.action.setBadgeText({ tabId, text: '!' });
  chrome.action.setBadgeBackgroundColor({ tabId, color: '#ef4444' }); // red
  chrome.action.setTitle({ tabId, title: 'VerifyAI - Analysis failed' });
}

/**
 * Clear badge for a tab
 */
function clearBadge(tabId) {
  chrome.action.setBadgeText({ tabId, text: '' });
  chrome.action.setTitle({ tabId, title: 'VerifyAI - Video Fact-Checker' });
}

/**
 * Handle tab removal
 */
function handleTabRemoved(tabId) {
  // Clean up any active jobs for this tab
  getActiveJob(tabId).then((activeJob) => {
    if (activeJob) {
      stopPolling(activeJob.jobId);
      removeActiveJob(tabId);
    }
  });
}

/**
 * Handle tab URL changes
 */
function handleTabUpdated(tabId, changeInfo, tab) {
  // When URL changes, clear badge and stop polling for old job
  if (changeInfo.url) {
    getActiveJob(tabId).then((activeJob) => {
      if (activeJob) {
        // Check if still on same URL
        const currentUrl = new URL(changeInfo.url);
        const oldUrl = new URL(activeJob.url);

        if (currentUrl.href !== oldUrl.href) {
          stopPolling(activeJob.jobId);
          removeActiveJob(tabId);
          clearBadge(tabId);
        }
      }
    });
  }
}

/**
 * Resume polling for any active jobs from previous session
 */
async function resumeActiveJobs() {
  const activeJobs = await getAllActiveJobs();

  for (const [tabId, jobInfo] of Object.entries(activeJobs)) {
    try {
      // Check if tab still exists
      let tab = null;
      try {
        tab = await getTab(parseInt(tabId));
      } catch {
        tab = null;
      }
      if (!tab) {
        await removeActiveJob(parseInt(tabId));
        continue;
      }

      // Check job status
      const job = await api.getJob(jobInfo.jobId);

      if (job.status === JOB_STATUSES.COMPLETED || job.status === JOB_STATUSES.FAILED) {
        // Job already done, update badge and remove
        updateBadge(parseInt(tabId), job);
        await removeActiveJob(parseInt(tabId));
      } else {
        // Resume polling
        startPolling(jobInfo.jobId, parseInt(tabId));
      }
    } catch (error) {
      console.error(`[VerifyAI] Error resuming job ${jobInfo.jobId}:`, error);
      await removeActiveJob(parseInt(tabId));
    }
  }
}

// Initialize on load
initialize();

// Handle install/update
chrome.runtime.onInstalled.addListener((details) => {
  console.log(`[VerifyAI] Extension ${details.reason}:`, details);

  if (details.reason === 'install') {
    // Open options page on first install
    chrome.runtime.openOptionsPage();
  }
});
