/**
 * YouTube platform adapter
 */

export const YouTubeAdapter = {
  id: 'youtube',
  name: 'YouTube',

  /**
   * Check if current page is a YouTube video page
   * @returns {boolean}
   */
  isVideoPage() {
    const url = window.location.href;
    return (
      /youtube\.com\/watch/.test(url) ||
      /youtube\.com\/shorts\//.test(url) ||
      /youtu\.be\//.test(url)
    );
  },

  /**
   * Get video information from the current page
   * @returns {{url: string, videoId: string, title: string}|null}
   */
  getVideoInfo() {
    if (!this.isVideoPage()) return null;

    const url = window.location.href;
    let videoId = null;

    // Extract video ID
    const watchMatch = url.match(/[?&]v=([a-zA-Z0-9_-]+)/);
    const shortsMatch = url.match(/\/shorts\/([a-zA-Z0-9_-]+)/);
    const shortUrlMatch = url.match(/youtu\.be\/([a-zA-Z0-9_-]+)/);

    if (watchMatch) {
      videoId = watchMatch[1];
    } else if (shortsMatch) {
      videoId = shortsMatch[1];
    } else if (shortUrlMatch) {
      videoId = shortUrlMatch[1];
    }

    // Get video title
    const titleEl = document.querySelector(
      'h1.ytd-video-primary-info-renderer, ' +
      'h1.ytd-watch-metadata, ' +
      'yt-formatted-string.ytd-watch-metadata, ' +
      '#title h1 yt-formatted-string'
    );
    const title = titleEl?.textContent?.trim() || '';

    return {
      url: this.getCanonicalUrl(videoId),
      videoId,
      title,
      platform: this.id,
    };
  },

  /**
   * Get canonical URL for a video ID
   * @param {string} videoId
   * @returns {string}
   */
  getCanonicalUrl(videoId) {
    return `https://www.youtube.com/watch?v=${videoId}`;
  },

  /**
   * Find the container element for injecting the badge
   * @returns {Element|null}
   */
  getBadgeContainer() {
    const isShorts = window.location.pathname.startsWith('/shorts/');

    if (isShorts) {
      // For shorts, inject near the action buttons
      return document.querySelector(
        'ytd-reel-video-renderer[is-active] #actions, ' +
        '#shorts-player .ytp-right-controls, ' +
        'ytd-reel-video-renderer[is-active] #toolbar'
      );
    }

    // For regular videos, inject in the player controls
    // Try right controls first (best position)
    const rightControls = document.querySelector('.ytp-right-controls');
    if (rightControls) return rightControls;

    // Fallback to below video
    const belowPlayer = document.querySelector('#below #top-row, #above-the-fold #top-row');
    if (belowPlayer) return belowPlayer;

    // Last resort: player container
    return document.querySelector('#movie_player, ytd-player');
  },

  /**
   * Get the position configuration for the badge
   * @returns {{placement: string, insertBefore: boolean}}
   */
  getBadgePosition() {
    const isShorts = window.location.pathname.startsWith('/shorts/');

    if (isShorts) {
      return {
        placement: 'shorts-overlay',
        insertBefore: true,
      };
    }

    const container = this.getBadgeContainer();
    if (container?.classList.contains('ytp-right-controls')) {
      return {
        placement: 'player-controls',
        insertBefore: true, // Insert at beginning of right controls
      };
    }

    return {
      placement: 'below-player',
      insertBefore: false,
    };
  },

  /**
   * Observe for dynamic content changes (SPA navigation)
   * @param {function} callback - Called when video changes
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

    // Watch for URL changes (YouTube uses History API)
    const handleNavigation = () => {
      setTimeout(checkForChange, 500); // Small delay for DOM to update
    };

    // Listen for popstate
    window.addEventListener('popstate', handleNavigation);

    // Watch for yt-navigate-finish event (YouTube-specific)
    window.addEventListener('yt-navigate-finish', handleNavigation);

    // Mutation observer as fallback
    const observer = new MutationObserver(() => {
      checkForChange();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    return () => {
      window.removeEventListener('popstate', handleNavigation);
      window.removeEventListener('yt-navigate-finish', handleNavigation);
      observer.disconnect();
    };
  },
};
