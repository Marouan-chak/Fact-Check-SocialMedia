/**
 * Facebook platform adapter
 * Supports both direct video URLs and feed scrolling
 */

export const FacebookAdapter = {
  id: 'facebook',
  name: 'Facebook',

  // Track processed videos to avoid duplicates
  processedVideos: new WeakSet(),
  // Store active badges by video element
  activeBadges: new WeakMap(),

  /**
   * Check if we're on Facebook (any page with potential videos)
   * @returns {boolean}
   */
  isVideoPage() {
    return /facebook\.com/.test(window.location.href);
  },

  /**
   * Check if URL is a direct video URL
   * @returns {boolean}
   */
  isDirectVideoUrl() {
    const url = window.location.href;
    return (
      /facebook\.com\/.*\/videos\//.test(url) ||
      /facebook\.com\/watch/.test(url) ||
      /facebook\.com\/reel\//.test(url) ||
      /fb\.watch\//.test(url)
    );
  },

  /**
   * Extract video ID from a URL
   * @param {string} url
   * @returns {string|null}
   */
  extractVideoId(url) {
    const videosMatch = url.match(/\/videos\/(\d+)/);
    const watchMatch = url.match(/[?&]v=(\d+)/);
    const reelMatch = url.match(/\/reel\/(\d+)/);
    const fbWatchMatch = url.match(/fb\.watch\/([a-zA-Z0-9]+)/);

    return videosMatch?.[1] || watchMatch?.[1] || reelMatch?.[1] || fbWatchMatch?.[1] || null;
  },

  /**
   * Get video information from the current page URL (for direct video pages)
   * @returns {{url: string, videoId: string}|null}
   */
  getVideoInfo() {
    if (!this.isDirectVideoUrl()) return null;

    const videoId = this.extractVideoId(window.location.href);
    if (!videoId) return null;

    return {
      url: window.location.href,
      videoId,
      platform: this.id,
    };
  },

  /**
   * Find the video container for a given video element
   * @param {HTMLVideoElement} video
   * @returns {Element|null}
   */
  getVideoContainer(video) {
    // Look for common Facebook video wrapper patterns
    let container = video.closest('[data-video-id]');

    if (!container) {
      container = video.closest('[data-pagelet*="Video"]');
    }

    if (!container) {
      // Traverse up to find a container with reasonable dimensions
      let parent = video.parentElement;
      let depth = 0;
      while (parent && depth < 10) {
        const rect = parent.getBoundingClientRect();
        if (rect.width > 200 && rect.height > 200) {
          // Check if this looks like a video container
          const hasVideoRelated = parent.querySelector('video') === video;
          if (hasVideoRelated) {
            container = parent;
            break;
          }
        }
        parent = parent.parentElement;
        depth++;
      }
    }

    return container;
  },

  /**
   * Generate a unique ID for a video
   * @param {HTMLVideoElement} video
   * @returns {string}
   */
  generateVideoId(video) {
    if (video.src) {
      // Extract ID from Facebook video URL if possible
      const match = video.src.match(/\/v\/(\d+)/);
      if (match) return match[1];
      return 'video-' + video.src.slice(-20);
    }
    const rect = video.getBoundingClientRect();
    return `video-${Math.round(rect.top)}-${Math.round(rect.left)}`;
  },

  /**
   * Find all videos currently in the viewport
   * @returns {Array<{video: HTMLVideoElement, container: Element, url: string, videoId: string}>}
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
        rect.height > 100
      );

      if (isVisible) {
        const container = this.getVideoContainer(video);
        const videoId = this.generateVideoId(video);

        if (container) {
          visibleVideos.push({
            video,
            container,
            url: window.location.href,
            videoId,
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
    if (this.isDirectVideoUrl()) {
      const video = document.querySelector('video');
      if (video) {
        return this.getVideoContainer(video);
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
    let lastVideoId = null;
    let scanTimeout = null;

    // For direct video URLs, use the old behavior
    const checkDirectVideo = () => {
      if (this.isDirectVideoUrl()) {
        const info = this.getVideoInfo();
        if (info && info.videoId !== lastVideoId) {
          lastVideoId = info.videoId;
          callback(info);
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
    setTimeout(checkDirectVideo, 500);
    scanForVideos();

    // Watch for URL changes
    const handleNavigation = () => {
      lastVideoId = null;
      setTimeout(() => {
        checkDirectVideo();
        scanForVideos();
      }, 500);
    };

    window.addEventListener('popstate', handleNavigation);

    // Scroll listener for feed
    const handleScroll = () => {
      scanForVideos();
    };
    window.addEventListener('scroll', handleScroll, { passive: true });

    // Facebook is heavily dynamic
    const observer = new MutationObserver(() => {
      if (this.isDirectVideoUrl()) {
        checkDirectVideo();
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
