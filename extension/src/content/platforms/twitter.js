/**
 * Twitter/X platform adapter
 */

export const TwitterAdapter = {
  id: 'twitter',
  name: 'X (Twitter)',

  /**
   * Check if current page is a Twitter video/status page
   * @returns {boolean}
   */
  isVideoPage() {
    const url = window.location.href;
    return (
      /twitter\.com\/[^/]+\/status\//.test(url) ||
      /x\.com\/[^/]+\/status\//.test(url)
    );
  },

  /**
   * Get video information from the current page
   * @returns {{url: string, tweetId: string, username: string}|null}
   */
  getVideoInfo() {
    if (!this.isVideoPage()) return null;

    const url = window.location.href;

    // Extract tweet ID and username
    const match = url.match(/(?:twitter|x)\.com\/([^/]+)\/status\/(\d+)/);

    if (!match) return null;

    const username = match[1];
    const tweetId = match[2];

    // Check if this tweet has video content
    const hasVideo = this.hasVideoContent();

    return {
      url: window.location.href,
      tweetId,
      username,
      hasVideo,
      platform: this.id,
    };
  },

  /**
   * Check if the current tweet has video content
   * @returns {boolean}
   */
  hasVideoContent() {
    // Look for video player elements
    const videoElement = document.querySelector(
      'article video, ' +
      '[data-testid="videoPlayer"], ' +
      '[data-testid="videoComponent"]'
    );

    return !!videoElement;
  },

  /**
   * Find the container element for injecting the badge
   * @returns {Element|null}
   */
  getBadgeContainer() {
    // Find the tweet article
    const article = document.querySelector(
      'article[data-testid="tweet"], ' +
      '[data-testid="tweetDetail"]'
    );

    if (article) {
      // Try to find video container within the tweet
      const videoContainer = article.querySelector(
        '[data-testid="videoPlayer"], ' +
        '[data-testid="videoComponent"], ' +
        'div[data-testid="card.wrapper"]'
      );

      if (videoContainer) {
        return videoContainer;
      }

      // Fallback to the tweet actions area
      const actions = article.querySelector('[role="group"]');
      if (actions) {
        return actions.parentElement || actions;
      }

      return article;
    }

    return null;
  },

  /**
   * Get the position configuration for the badge
   * @returns {{placement: string, insertBefore: boolean}}
   */
  getBadgePosition() {
    return {
      placement: 'tweet-actions',
      insertBefore: true,
    };
  },

  /**
   * Observe for dynamic content changes
   * @param {function} callback - Called when content changes
   * @returns {function} Cleanup function
   */
  observeChanges(callback) {
    let lastTweetId = null;

    const checkForChange = () => {
      const info = this.getVideoInfo();
      if (info && info.tweetId !== lastTweetId) {
        lastTweetId = info.tweetId;
        // Only trigger callback if there's video content
        if (info.hasVideo) {
          callback(info);
        }
      }
    };

    // Check immediately
    setTimeout(checkForChange, 500);

    // Watch for URL changes
    const handleNavigation = () => {
      setTimeout(checkForChange, 500);
    };

    window.addEventListener('popstate', handleNavigation);

    // Mutation observer for Twitter's dynamic content
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
