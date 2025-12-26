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
    // Support multiple badges for feed scrolling
    this.badges = new Map(); // postId -> { badge, video, url }
    this.jobs = new Map(); // postId -> job info
    // Extension enabled state
    this.isEnabled = true;
  }

  /**
   * Initialize the content script
   */
  async initialize() {
    console.log('[VerifyAI] Content script initializing...');

    // Always set up message listener first (to receive enable/disable messages)
    this.setupMessageListener();

    // Check if extension is enabled
    try {
      const settings = await sendToBackground(MESSAGE_TYPES.GET_SETTINGS);
      this.isEnabled = settings?.enabled !== false;
    } catch (error) {
      console.warn('[VerifyAI] Could not get settings, defaulting to enabled');
      this.isEnabled = true;
    }

    if (!this.isEnabled) {
      console.log('[VerifyAI] Extension is disabled');
      return;
    }

    // Detect platform
    this.platform = detectPlatform();

    if (!this.platform) {
      console.log('[VerifyAI] Not a supported video page');
      return;
    }

    console.log(`[VerifyAI] Detected platform: ${this.platform.name}`);

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
          this.handleJobFailed(message.error, message.jobId);
          break;
        case MESSAGE_TYPES.SETTINGS_UPDATED:
          this.handleSettingsUpdated(message);
          break;
      }
    });
  }

  /**
   * Handle settings updated (enable/disable toggle)
   */
  handleSettingsUpdated(message) {
    const wasEnabled = this.isEnabled;
    this.isEnabled = message.enabled !== false;

    console.log(`[VerifyAI] Extension ${this.isEnabled ? 'enabled' : 'disabled'}`);

    if (wasEnabled && !this.isEnabled) {
      // Was enabled, now disabled - hide all badges
      this.hideAllBadges();
    } else if (!wasEnabled && this.isEnabled) {
      // Was disabled, now enabled - reinitialize
      this.reinitialize();
    }
  }

  /**
   * Hide all badges (when extension is disabled)
   */
  hideAllBadges() {
    // Hide single badge
    if (this.badge) {
      this.badge.remove();
      this.badge = null;
    }

    // Hide all multi-video badges
    for (const [postId, badgeInfo] of this.badges) {
      if (badgeInfo.badge) {
        badgeInfo.badge.remove();
      }
      if (this.platform?.unregisterBadge && badgeInfo.video) {
        this.platform.unregisterBadge(badgeInfo.video);
      }
    }
    this.badges.clear();

    // Stop observing
    if (this.cleanupFn) {
      this.cleanupFn();
      this.cleanupFn = null;
    }
  }

  /**
   * Reinitialize when re-enabled
   */
  async reinitialize() {
    // Detect platform if not already
    if (!this.platform) {
      this.platform = detectPlatform();
    }

    if (!this.platform) {
      console.log('[VerifyAI] Not a supported video page');
      return;
    }

    console.log(`[VerifyAI] Reinitializing for platform: ${this.platform.name}`);

    // Start observing for video changes
    this.cleanupFn = this.platform.observeChanges((videoInfo) => {
      this.handleVideoChange(videoInfo);
    });
  }

  /**
   * Handle video change (new video detected)
   */
  async handleVideoChange(videoInfo) {
    console.log('[VerifyAI] Video detected:', videoInfo);

    // Multi-video mode (feed scrolling)
    if (videoInfo.isMultiVideo && videoInfo.video && videoInfo.container) {
      await this.handleMultiVideoChange(videoInfo);
      return;
    }

    // Single video mode (direct URL)
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
   * Handle multi-video mode (feed scrolling with multiple videos)
   */
  async handleMultiVideoChange(videoInfo) {
    const { video, container, url, postId } = videoInfo;

    // Skip if already have a badge for this video
    if (this.badges.has(postId)) {
      return;
    }

    // Check if platform tracks this video
    if (this.platform.hasBadge && this.platform.hasBadge(video)) {
      return;
    }

    console.log('[VerifyAI] Adding badge for video:', postId);

    // Check for cached result
    let cachedResult = null;
    try {
      cachedResult = await sendToBackground(MESSAGE_TYPES.GET_CACHED_RESULT, {
        url: url,
      });
    } catch (error) {
      console.warn('[VerifyAI] Error checking cache:', error);
    }

    // Ensure container has position relative for absolute positioning
    const containerStyle = window.getComputedStyle(container);
    if (containerStyle.position === 'static') {
      container.style.position = 'relative';
    }

    const position = this.platform.getBadgePosition();

    const badge = new Badge({
      container,
      position,
      platform: this.platform.id,
      onFactCheck: () => this.startFactCheckForVideo(postId, url),
      onOpenPanel: () => this.openSidePanel(),
    });

    badge.inject();

    // Register with platform
    if (this.platform.registerBadge) {
      this.platform.registerBadge(video, badge);
    }

    // Store badge info
    this.badges.set(postId, { badge, video, url });

    // Show cached result if available
    if (cachedResult && cachedResult.status === JOB_STATUSES.COMPLETED) {
      badge.showResult(cachedResult.report);
    }
  }

  /**
   * Start fact-checking for a specific video (multi-video mode)
   */
  async startFactCheckForVideo(postId, url) {
    const badgeInfo = this.badges.get(postId);
    if (!badgeInfo) {
      console.error('[VerifyAI] No badge found for postId:', postId);
      return;
    }

    console.log('[VerifyAI] Starting fact check for:', url);

    badgeInfo.badge.setLoading(true);

    try {
      // Get settings for language
      const settings = await sendToBackground(MESSAGE_TYPES.GET_SETTINGS);
      const language = settings?.language || 'en';

      // Start fact check
      const response = await sendToBackground(MESSAGE_TYPES.START_FACT_CHECK, {
        url: url,
        language,
      });

      // Store job info
      this.jobs.set(response.job_id, { postId, url });

      if (response.cached && response.job) {
        // Already have result
        badgeInfo.badge.showResult(response.job.report);
      }
    } catch (error) {
      console.error('[VerifyAI] Error starting fact check:', error);
      badgeInfo.badge.showError(error.message);
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
    // Try multi-video mode first
    const jobInfo = this.jobs.get(job?.id);
    if (jobInfo) {
      const badgeInfo = this.badges.get(jobInfo.postId);
      if (badgeInfo?.badge) {
        badgeInfo.badge.updateProgress(job.progress, job.status);
        if (job.thought_summaries?.length > 0) {
          const latestThought = job.thought_summaries[job.thought_summaries.length - 1];
          badgeInfo.badge.showThought(latestThought);
        }
        return;
      }
    }

    // Fallback to single-video mode
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

    // Try multi-video mode first
    const jobInfo = this.jobs.get(job?.id);
    if (jobInfo) {
      const badgeInfo = this.badges.get(jobInfo.postId);
      if (badgeInfo?.badge && job?.report) {
        badgeInfo.badge.showResult(job.report);
        return;
      }
    }

    // Fallback to single-video mode
    if (this.badge && job?.report) {
      this.badge.showResult(job.report);
    }
  }

  /**
   * Handle job failed event
   */
  handleJobFailed(error, jobId) {
    console.log('[VerifyAI] Job failed:', error);

    // Try multi-video mode first
    const jobInfo = this.jobs.get(jobId);
    if (jobInfo) {
      const badgeInfo = this.badges.get(jobInfo.postId);
      if (badgeInfo?.badge) {
        badgeInfo.badge.showError(error || 'Analysis failed');
        return;
      }
    }

    // Fallback to single-video mode
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
    // Clean up all badges in multi-video mode
    for (const [postId, badgeInfo] of this.badges) {
      if (badgeInfo.badge) {
        badgeInfo.badge.remove();
      }
      if (this.platform.unregisterBadge && badgeInfo.video) {
        this.platform.unregisterBadge(badgeInfo.video);
      }
    }
    this.badges.clear();
    this.jobs.clear();
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
