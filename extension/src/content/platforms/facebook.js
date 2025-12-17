/**
 * Facebook platform adapter
 */

export const FacebookAdapter = {
  id: 'facebook',
  name: 'Facebook',

  /**
   * Check if current page is a Facebook video page
   * @returns {boolean}
   */
  isVideoPage() {
    const url = window.location.href;
    return (
      /facebook\.com\/.*\/videos\//.test(url) ||
      /facebook\.com\/watch/.test(url) ||
      /facebook\.com\/reel\//.test(url) ||
      /fb\.watch\//.test(url)
    );
  },

  /**
   * Get video information from the current page
   * @returns {{url: string, videoId: string}|null}
   */
  getVideoInfo() {
    if (!this.isVideoPage()) return null;

    const url = window.location.href;

    // Extract video ID from various URL formats
    let videoId = null;

    const videosMatch = url.match(/\/videos\/(\d+)/);
    const watchMatch = url.match(/[?&]v=(\d+)/);
    const reelMatch = url.match(/\/reel\/(\d+)/);
    const fbWatchMatch = url.match(/fb\.watch\/([a-zA-Z0-9]+)/);

    if (videosMatch) {
      videoId = videosMatch[1];
    } else if (watchMatch) {
      videoId = watchMatch[1];
    } else if (reelMatch) {
      videoId = reelMatch[1];
    } else if (fbWatchMatch) {
      videoId = fbWatchMatch[1];
    }

    if (!videoId) return null;

    return {
      url: window.location.href,
      videoId,
      platform: this.id,
    };
  },

  /**
   * Find the container element for injecting the badge
   * @returns {Element|null}
   */
  getBadgeContainer() {
    // For watch page
    const watchPlayer = document.querySelector(
      '[data-pagelet="WatchPermalinkVideo"] video, ' +
      '[data-video-id] video'
    )?.closest('div[class*="video"]');

    if (watchPlayer) {
      return watchPlayer;
    }

    // For reels
    const reelContainer = document.querySelector(
      '[data-pagelet="ReelPlayer"], ' +
      'div[class*="reel"] video'
    )?.closest('div');

    if (reelContainer) {
      return reelContainer;
    }

    // Generic video container
    const videoContainer = document.querySelector(
      'video[src*="video"], ' +
      'video[src*="fbcdn"]'
    )?.closest('div');

    if (videoContainer) {
      return videoContainer;
    }

    // Fallback to main content
    return document.querySelector(
      '[role="main"] [data-pagelet], ' +
      '[role="main"]'
    );
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
    setTimeout(checkForChange, 500);

    // Watch for URL changes
    const handleNavigation = () => {
      setTimeout(checkForChange, 500);
    };

    window.addEventListener('popstate', handleNavigation);

    // Facebook is heavily dynamic
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
