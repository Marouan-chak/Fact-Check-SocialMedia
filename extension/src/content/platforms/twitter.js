/**
 * Twitter/X platform adapter
 * Supports both direct tweet URLs and feed/timeline scrolling
 */

export const TwitterAdapter = {
  id: 'twitter',
  name: 'X (Twitter)',

  // Track processed videos to avoid duplicates
  processedVideos: new WeakSet(),
  // Store active badges by video element
  activeBadges: new WeakMap(),

  /**
   * Check if we're on Twitter/X (any page with potential videos)
   * @returns {boolean}
   */
  isVideoPage() {
    return /(?:twitter|x)\.com/.test(window.location.href);
  },

  /**
   * Check if URL is a direct tweet URL
   * @returns {boolean}
   */
  isDirectTweetUrl() {
    const url = window.location.href;
    return (
      /twitter\.com\/[^/]+\/status\//.test(url) ||
      /x\.com\/[^/]+\/status\//.test(url)
    );
  },

  /**
   * Extract tweet info from a URL
   * @param {string} url
   * @returns {{tweetId: string, username: string}|null}
   */
  extractTweetInfo(url) {
    const match = url.match(/(?:twitter|x)\.com\/([^/]+)\/status\/(\d+)/);
    if (!match) return null;
    return { username: match[1], tweetId: match[2] };
  },

  /**
   * Get video information from the current page URL (for direct tweet pages)
   * @returns {{url: string, tweetId: string, username: string}|null}
   */
  getVideoInfo() {
    if (!this.isDirectTweetUrl()) return null;

    const info = this.extractTweetInfo(window.location.href);
    if (!info) return null;

    // Check if this tweet has video content
    const hasVideo = this.hasVideoContent();

    return {
      url: window.location.href,
      ...info,
      hasVideo,
      platform: this.id,
    };
  },

  /**
   * Check if the current tweet has video content
   * @returns {boolean}
   */
  hasVideoContent() {
    const videoElement = document.querySelector(
      'article video, ' +
      '[data-testid="videoPlayer"], ' +
      '[data-testid="videoComponent"]'
    );
    return !!videoElement;
  },

  /**
   * Find the video container for a given video element
   * @param {HTMLVideoElement} video
   * @returns {Element|null}
   */
  getVideoContainer(video) {
    // Look for the tweet article containing this video
    let container = video.closest('article[data-testid="tweet"]');

    if (!container) {
      container = video.closest('[data-testid="videoPlayer"]');
    }

    if (!container) {
      container = video.closest('[data-testid="videoComponent"]');
    }

    if (!container) {
      // Traverse up to find a suitable container
      let parent = video.parentElement;
      let depth = 0;
      while (parent && depth < 10) {
        const rect = parent.getBoundingClientRect();
        if (rect.width > 200 && rect.height > 150) {
          container = parent;
          break;
        }
        parent = parent.parentElement;
        depth++;
      }
    }

    return container;
  },

  /**
   * Get tweet URL for a video element (from nearby links)
   * @param {HTMLVideoElement} video
   * @returns {string|null}
   */
  getTweetUrlForVideo(video) {
    const article = video.closest('article[data-testid="tweet"]');
    if (article) {
      // Look for the tweet permalink
      const timeLink = article.querySelector('a[href*="/status/"] time')?.parentElement;
      if (timeLink?.href) {
        return timeLink.href;
      }
      // Try other status links
      const statusLink = article.querySelector('a[href*="/status/"]');
      if (statusLink?.href) {
        return statusLink.href;
      }
    }

    if (this.isDirectTweetUrl()) {
      return window.location.href;
    }

    return null;
  },

  /**
   * Generate a unique ID for a video
   * @param {HTMLVideoElement} video
   * @returns {string}
   */
  generateVideoId(video) {
    // Try to get tweet ID from nearby link
    const tweetUrl = this.getTweetUrlForVideo(video);
    if (tweetUrl) {
      const info = this.extractTweetInfo(tweetUrl);
      if (info) return info.tweetId;
    }

    if (video.src) {
      return 'video-' + video.src.slice(-20);
    }
    const rect = video.getBoundingClientRect();
    return `video-${Math.round(rect.top)}-${Math.round(rect.left)}`;
  },

  /**
   * Find all videos currently in the viewport
   * @returns {Array<{video: HTMLVideoElement, container: Element, url: string, tweetId: string}>}
   */
  findVisibleVideos() {
    const videos = document.querySelectorAll('video');
    const visibleVideos = [];

    for (const video of videos) {
      // Skip already processed videos that have badges
      if (this.activeBadges.has(video)) continue;

      const rect = video.getBoundingClientRect();
      const isVisible = (
        rect.top < window.innerHeight &&
        rect.bottom > 0 &&
        rect.width > 100 &&
        rect.height > 80
      );

      if (isVisible) {
        const container = this.getVideoContainer(video);
        const url = this.getTweetUrlForVideo(video);
        const tweetId = this.generateVideoId(video);

        if (container) {
          visibleVideos.push({
            video,
            container,
            url: url || window.location.href,
            tweetId,
            postId: tweetId, // Normalize for content script
          });
        }
      }
    }

    return visibleVideos;
  },

  /**
   * Find the container element for injecting the badge (single video mode)
   * @returns {Element|null}
   */
  getBadgeContainer() {
    if (this.isDirectTweetUrl()) {
      const article = document.querySelector(
        'article[data-testid="tweet"], ' +
        '[data-testid="tweetDetail"]'
      );

      if (article) {
        const videoContainer = article.querySelector(
          '[data-testid="videoPlayer"], ' +
          '[data-testid="videoComponent"], ' +
          'div[data-testid="card.wrapper"]'
        );

        if (videoContainer) {
          return videoContainer;
        }

        const actions = article.querySelector('[role="group"]');
        if (actions) {
          return actions.parentElement || actions;
        }

        return article;
      }
    }
    return null;
  },

  /**
   * Get the position configuration for the badge
   * @returns {{placement: string, insertBefore: boolean}}
   */
  getBadgePosition() {
    return {
      placement: 'overlay',
      insertBefore: false,
    };
  },

  /**
   * Register a badge for a video element
   * @param {HTMLVideoElement} video
   * @param {Badge} badge
   */
  registerBadge(video, badge) {
    this.activeBadges.set(video, badge);
    this.processedVideos.add(video);
  },

  /**
   * Unregister a badge for a video element
   * @param {HTMLVideoElement} video
   */
  unregisterBadge(video) {
    this.activeBadges.delete(video);
  },

  /**
   * Check if video already has a badge
   * @param {HTMLVideoElement} video
   * @returns {boolean}
   */
  hasBadge(video) {
    return this.activeBadges.has(video);
  },

  /**
   * Observe for dynamic content changes
   * @param {function} callback - Called when content changes
   * @returns {function} Cleanup function
   */
  observeChanges(callback) {
    let lastTweetId = null;
    let scanTimeout = null;

    // For direct tweet URLs, use the old behavior
    const checkDirectTweet = () => {
      if (this.isDirectTweetUrl()) {
        const info = this.getVideoInfo();
        if (info && info.tweetId !== lastTweetId) {
          lastTweetId = info.tweetId;
          if (info.hasVideo) {
            callback(info);
          }
        }
      }
    };

    // Scan for visible videos (for feed scrolling)
    const scanForVideos = () => {
      if (scanTimeout) {
        clearTimeout(scanTimeout);
      }
      scanTimeout = setTimeout(() => {
        const visibleVideos = this.findVisibleVideos();
        for (const videoInfo of visibleVideos) {
          callback({
            ...videoInfo,
            platform: this.id,
            isMultiVideo: true,
          });
        }
      }, 300);
    };

    // Check immediately
    setTimeout(checkDirectTweet, 500);
    scanForVideos();

    // Watch for URL changes
    const handleNavigation = () => {
      lastTweetId = null;
      setTimeout(() => {
        checkDirectTweet();
        scanForVideos();
      }, 500);
    };

    window.addEventListener('popstate', handleNavigation);

    // Scroll listener for feed
    const handleScroll = () => {
      scanForVideos();
    };
    window.addEventListener('scroll', handleScroll, { passive: true });

    // Mutation observer for Twitter's dynamic content
    const observer = new MutationObserver(() => {
      if (this.isDirectTweetUrl()) {
        checkDirectTweet();
      }
      scanForVideos();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    return () => {
      window.removeEventListener('popstate', handleNavigation);
      window.removeEventListener('scroll', handleScroll);
      observer.disconnect();
      if (scanTimeout) clearTimeout(scanTimeout);
    };
  },
};
