/**
 * Instagram platform adapter
 */

export const InstagramAdapter = {
  id: 'instagram',
  name: 'Instagram',

  /**
   * Check if current page is an Instagram video page
   * @returns {boolean}
   */
  isVideoPage() {
    const url = window.location.href;
    return (
      /instagram\.com\/p\//.test(url) ||
      /instagram\.com\/reel\//.test(url) ||
      /instagram\.com\/reels\//.test(url)
    );
  },

  /**
   * Get video information from the current page
   * @returns {{url: string, postId: string}|null}
   */
  getVideoInfo() {
    if (!this.isVideoPage()) return null;

    const url = window.location.href;

    // Extract post/reel ID
    const postMatch = url.match(/\/p\/([a-zA-Z0-9_-]+)/);
    const reelMatch = url.match(/\/reel\/([a-zA-Z0-9_-]+)/);
    const reelsMatch = url.match(/\/reels\/([a-zA-Z0-9_-]+)/);

    const postId = postMatch?.[1] || reelMatch?.[1] || reelsMatch?.[1];

    if (!postId) return null;

    return {
      url: window.location.href,
      postId,
      platform: this.id,
    };
  },

  /**
   * Find the container element for injecting the badge
   * @returns {Element|null}
   */
  getBadgeContainer() {
    // For reels page - inject near video
    const reelVideo = document.querySelector(
      'section[role="presentation"] video, ' +
      'div[role="dialog"] video'
    )?.closest('div');

    if (reelVideo) {
      return reelVideo.parentElement || reelVideo;
    }

    // For post page - inject near the media container
    const postMedia = document.querySelector(
      'article[role="presentation"] div[role="button"], ' +
      'main article div[role="button"]'
    );

    if (postMedia) {
      return postMedia.closest('article') || postMedia;
    }

    // Fallback to main content area
    return document.querySelector('main article, section main');
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
    let lastPostId = null;

    const checkForChange = () => {
      const info = this.getVideoInfo();
      if (info && info.postId !== lastPostId) {
        lastPostId = info.postId;
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

    // Mutation observer
    const observer = new MutationObserver(() => {
      const url = window.location.href;
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
