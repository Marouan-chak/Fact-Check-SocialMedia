/**
 * TikTok platform adapter
 */

export const TikTokAdapter = {
  id: 'tiktok',
  name: 'TikTok',

  /**
   * Check if current page is a TikTok video page
   * @returns {boolean}
   */
  isVideoPage() {
    const url = window.location.href;
    return (
      /tiktok\.com\/@[^/]+\/video\//.test(url) ||
      /tiktok\.com\/t\//.test(url)
    );
  },

  /**
   * Get video information from the current page
   * @returns {{url: string, videoId: string, username: string}|null}
   */
  getVideoInfo() {
    if (!this.isVideoPage()) return null;

    const url = window.location.href;

    // Extract video ID and username
    const videoMatch = url.match(/\/@([^/]+)\/video\/(\d+)/);
    const shortMatch = url.match(/\/t\/([a-zA-Z0-9]+)/);

    let videoId = null;
    let username = null;

    if (videoMatch) {
      username = videoMatch[1];
      videoId = videoMatch[2];
    } else if (shortMatch) {
      videoId = shortMatch[1];
    }

    if (!videoId) return null;

    return {
      url: window.location.href,
      videoId,
      username,
      platform: this.id,
    };
  },

  /**
   * Find the container element for injecting the badge
   * @returns {Element|null}
   */
  getBadgeContainer() {
    // Try to find the video player container
    const videoContainer = document.querySelector(
      '[data-e2e="browse-video"] .tiktok-web-player, ' +
      '[data-e2e="video-player"], ' +
      'div[class*="DivVideoContainer"], ' +
      'div[class*="DivPlayerContainer"]'
    );

    if (videoContainer) {
      return videoContainer;
    }

    // Fallback to video element parent
    const video = document.querySelector('video');
    if (video) {
      return video.closest('div[class*="Video"]') || video.parentElement;
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
   * Observe for dynamic content changes
   * @param {function} callback - Called when content changes
   * @returns {function} Cleanup function
   */
  observeChanges(callback) {
    let lastVideoId = null;

    const checkForChange = () => {
      const info = this.getVideoInfo();
      if (info && info.videoId !== lastVideoId) {
        lastVideoId = info.videoId;
        callback(info);
      }
    };

    // Check immediately
    checkForChange();

    // Watch for URL changes
    const handleNavigation = () => {
      setTimeout(checkForChange, 500);
    };

    window.addEventListener('popstate', handleNavigation);

    // TikTok uses a lot of dynamic loading
    const observer = new MutationObserver(() => {
      if (this.isVideoPage()) {
        checkForChange();
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    return () => {
      window.removeEventListener('popstate', handleNavigation);
      observer.disconnect();
    };
  },
};
