/**
 * Instagram platform adapter
 * Supports both direct video URLs and feed/reels scrolling
 */

export const InstagramAdapter = {
  id: 'instagram',
  name: 'Instagram',

  // Track processed videos to avoid duplicates
  processedVideos: new WeakSet(),
  // Store active badges by video element
  activeBadges: new WeakMap(),

  /**
   * Check if we're on Instagram (any page with potential videos)
   * @returns {boolean}
   */
  isVideoPage() {
    return /instagram\.com/.test(window.location.href);
  },

  /**
   * Check if URL is a direct video/reel URL
   * @returns {boolean}
   */
  isDirectVideoUrl() {
    const url = window.location.href;
    return (
      /instagram\.com\/p\//.test(url) ||
      /instagram\.com\/reel\//.test(url) ||
      /instagram\.com\/reels\//.test(url)
    );
  },

  /**
   * Extract post ID from a URL or link element
   * @param {string} url
   * @returns {string|null}
   */
  extractPostId(url) {
    const postMatch = url.match(/\/p\/([a-zA-Z0-9_-]+)/);
    const reelMatch = url.match(/\/reel\/([a-zA-Z0-9_-]+)/);
    const reelsMatch = url.match(/\/reels\/([a-zA-Z0-9_-]+)/);
    return postMatch?.[1] || reelMatch?.[1] || reelsMatch?.[1] || null;
  },

  /**
   * Get video information from the current page URL (for direct video pages)
   * @returns {{url: string, postId: string}|null}
   */
  getVideoInfo() {
    if (!this.isDirectVideoUrl()) return null;

    const postId = this.extractPostId(window.location.href);
    if (!postId) return null;

    return {
      url: window.location.href,
      postId,
      platform: this.id,
    };
  },

  /**
   * Find the video container for a given video element
   * @param {HTMLVideoElement} video
   * @returns {Element|null}
   */
  getVideoContainer(video) {
    // Look for the article/post container that holds this video
    // Instagram wraps videos in nested divs within an article
    let container = video.closest('article');

    if (!container) {
      // For reels in the feed, look for the parent with specific structure
      container = video.closest('[role="presentation"]');
    }

    if (!container) {
      // Fallback: traverse up to find a suitable container
      let parent = video.parentElement;
      let depth = 0;
      while (parent && depth < 8) {
        // Look for a container that has reasonable dimensions
        const rect = parent.getBoundingClientRect();
        if (rect.width > 200 && rect.height > 200) {
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
   * Get post URL for a video element (from nearby links)
   * @param {HTMLVideoElement} video
   * @returns {string|null}
   */
  getPostUrlForVideo(video) {
    const container = this.getVideoContainer(video);
    if (!container) return null;

    // Look for a link to the post/reel
    const links = container.querySelectorAll('a[href*="/p/"], a[href*="/reel/"], a[href*="/reels/"]');
    for (const link of links) {
      const postId = this.extractPostId(link.href);
      if (postId) {
        return link.href;
      }
    }

    // If on a direct video URL, use that
    if (this.isDirectVideoUrl()) {
      return window.location.href;
    }

    return null;
  },

  /**
   * Find all videos currently in the viewport
   * @returns {Array<{video: HTMLVideoElement, container: Element, url: string, postId: string}>}
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
        const url = this.getPostUrlForVideo(video);
        const postId = url ? this.extractPostId(url) : this.generateVideoId(video);

        if (container) {
          visibleVideos.push({
            video,
            container,
            url: url || window.location.href,
            postId: postId || this.generateVideoId(video),
          });
        }
      }
    }

    return visibleVideos;
  },

  /**
   * Generate a unique ID for a video without a post URL
   * @param {HTMLVideoElement} video
   * @returns {string}
   */
  generateVideoId(video) {
    // Use video src or a hash of position as fallback ID
    if (video.src) {
      return 'video-' + video.src.slice(-20);
    }
    const rect = video.getBoundingClientRect();
    return `video-${Math.round(rect.top)}-${Math.round(rect.left)}`;
  },

  /**
   * Find the container element for injecting the badge (single video mode)
   * @returns {Element|null}
   */
  getBadgeContainer() {
    // For direct video pages
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
   * Observe for dynamic content changes (videos appearing/disappearing)
   * @param {function} callback - Called when videos change. Receives array of video info.
   * @returns {function} Cleanup function
   */
  observeChanges(callback) {
    let lastPostId = null;
    let scanTimeout = null;

    // For direct video URLs, use the old behavior
    const checkDirectVideo = () => {
      if (this.isDirectVideoUrl()) {
        const info = this.getVideoInfo();
        if (info && info.postId !== lastPostId) {
          lastPostId = info.postId;
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
      }, 300); // Debounce
    };

    // Check immediately
    checkDirectVideo();
    scanForVideos();

    // Watch for URL changes
    const handleNavigation = () => {
      lastPostId = null;
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

    // Mutation observer for dynamic content
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

    // Intersection observer for video visibility
    const intersectionObserver = new IntersectionObserver(
      (entries) => {
        const hasNewVisible = entries.some(e => e.isIntersecting);
        if (hasNewVisible) {
          scanForVideos();
        }
      },
      { threshold: 0.3 }
    );

    // Observe all videos
    const observeVideos = () => {
      document.querySelectorAll('video').forEach(video => {
        intersectionObserver.observe(video);
      });
    };
    observeVideos();

    // Re-observe when new videos added
    const videoObserver = new MutationObserver(() => {
      observeVideos();
    });
    videoObserver.observe(document.body, { childList: true, subtree: true });

    return () => {
      window.removeEventListener('popstate', handleNavigation);
      window.removeEventListener('scroll', handleScroll);
      observer.disconnect();
      intersectionObserver.disconnect();
      videoObserver.disconnect();
      if (scanTimeout) clearTimeout(scanTimeout);
    };
  },
};
