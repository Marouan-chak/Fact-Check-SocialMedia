/**
 * VerifyAI Content Script
 * Detects video pages and injects the fact-checking badge
 */

import { detectPlatform } from './platforms/index.js';
import { Badge } from './ui/badge.js';
import { sendToBackground, onMessage } from '../shared/messaging.js';
import { MESSAGE_TYPES, JOB_STATUSES } from '../shared/constants.js';

class ContentScript {
  constructor() {
    this.platform = null;
    this.badge = null;
    this.currentUrl = null;
    this.currentJob = null;
    this.cleanupFn = null;
  }

  /**
   * Initialize the content script
   */
  async initialize() {
    console.log('[VerifyAI] Content script initializing...');

    // Detect platform
    this.platform = detectPlatform();

    if (!this.platform) {
      console.log('[VerifyAI] Not a supported video page');
      return;
    }

    console.log(`[VerifyAI] Detected platform: ${this.platform.name}`);

    // Set up message listener
    this.setupMessageListener();

    // Start observing for video changes
    this.cleanupFn = this.platform.observeChanges((videoInfo) => {
      this.handleVideoChange(videoInfo);
    });
  }

  /**
   * Set up listener for messages from background
   */
  setupMessageListener() {
    onMessage((message, sender) => {
      switch (message.type) {
        case MESSAGE_TYPES.JOB_STARTED:
          this.handleJobStarted(message);
          break;
        case MESSAGE_TYPES.JOB_UPDATE:
          this.handleJobUpdate(message.job);
          break;
        case MESSAGE_TYPES.JOB_COMPLETED:
          this.handleJobCompleted(message.job);
          break;
        case MESSAGE_TYPES.JOB_FAILED:
          this.handleJobFailed(message.error);
          break;
      }
    });
  }

  /**
   * Handle video change (new video detected)
   */
  async handleVideoChange(videoInfo) {
    console.log('[VerifyAI] Video detected:', videoInfo);

    // Remove existing badge
    if (this.badge) {
      this.badge.remove();
      this.badge = null;
    }

    this.currentUrl = videoInfo.url;
    this.currentJob = null;

    // Check for cached result
    let cachedResult = null;
    try {
      cachedResult = await sendToBackground(MESSAGE_TYPES.GET_CACHED_RESULT, {
        url: videoInfo.url,
      });
    } catch (error) {
      console.warn('[VerifyAI] Error checking cache:', error);
    }

    // Wait a bit for the page to stabilize
    await this.waitForElement(() => this.platform.getBadgeContainer());

    // Create and inject badge
    const container = this.platform.getBadgeContainer();
    if (!container) {
      console.warn('[VerifyAI] Could not find badge container');
      return;
    }

    const position = this.platform.getBadgePosition();

    this.badge = new Badge({
      container,
      position,
      platform: this.platform.id,
      onFactCheck: () => this.startFactCheck(),
      onOpenPanel: () => this.openSidePanel(),
    });

    this.badge.inject();

    // Show cached result if available
    if (cachedResult && cachedResult.status === JOB_STATUSES.COMPLETED) {
      this.badge.showResult(cachedResult.report);
    }
  }

  /**
   * Start fact-checking the current video
   */
  async startFactCheck() {
    if (!this.currentUrl) {
      console.error('[VerifyAI] No URL to fact-check');
      return;
    }

    console.log('[VerifyAI] Starting fact check for:', this.currentUrl);

    this.badge.setLoading(true);

    try {
      // Get settings for language
      const settings = await sendToBackground(MESSAGE_TYPES.GET_SETTINGS);
      const language = settings?.language || 'en';

      // Start fact check
      const response = await sendToBackground(MESSAGE_TYPES.START_FACT_CHECK, {
        url: this.currentUrl,
        language,
      });

      this.currentJob = response.job_id;

      if (response.cached && response.job) {
        // Already have result
        this.badge.showResult(response.job.report);
      }
    } catch (error) {
      console.error('[VerifyAI] Error starting fact check:', error);
      this.badge.showError(error.message);
    }
  }

  /**
   * Handle job started event
   */
  handleJobStarted(data) {
    console.log('[VerifyAI] Job started:', data.jobId);

    if (this.badge) {
      this.badge.setLoading(true);

      if (data.cached) {
        this.badge.showCacheIndicator();
      }
    }
  }

  /**
   * Handle job update event
   */
  handleJobUpdate(job) {
    if (this.badge && job) {
      this.badge.updateProgress(job.progress, job.status);

      // Show latest thought summary
      if (job.thought_summaries?.length > 0) {
        const latestThought = job.thought_summaries[job.thought_summaries.length - 1];
        this.badge.showThought(latestThought);
      }
    }
  }

  /**
   * Handle job completed event
   */
  handleJobCompleted(job) {
    console.log('[VerifyAI] Job completed:', job?.id);

    if (this.badge && job?.report) {
      this.badge.showResult(job.report);
    }
  }

  /**
   * Handle job failed event
   */
  handleJobFailed(error) {
    console.log('[VerifyAI] Job failed:', error);

    if (this.badge) {
      this.badge.showError(error || 'Analysis failed');
    }
  }

  /**
   * Open the side panel
   */
  async openSidePanel() {
    try {
      await sendToBackground(MESSAGE_TYPES.OPEN_SIDE_PANEL);
    } catch (error) {
      console.error('[VerifyAI] Error opening side panel:', error);
    }
  }

  /**
   * Wait for an element to appear
   */
  waitForElement(getter, timeout = 5000) {
    return new Promise((resolve) => {
      const element = getter();
      if (element) {
        resolve(element);
        return;
      }

      const observer = new MutationObserver(() => {
        const element = getter();
        if (element) {
          observer.disconnect();
          resolve(element);
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
      });

      // Timeout
      setTimeout(() => {
        observer.disconnect();
        resolve(getter());
      }, timeout);
    });
  }

  /**
   * Cleanup
   */
  destroy() {
    if (this.cleanupFn) {
      this.cleanupFn();
    }
    if (this.badge) {
      this.badge.remove();
    }
  }
}

// Initialize when DOM is ready
const init = () => {
  const contentScript = new ContentScript();
  contentScript.initialize();
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
