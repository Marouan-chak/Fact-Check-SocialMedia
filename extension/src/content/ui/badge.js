/**
 * VerifyAI Inline Badge Component
 * Displays the fact-check button and results on video pages
 */

import {
  STATUS_LABELS,
  VERDICT_LABELS,
  getScoreColor,
  getVerdictColor,
} from '../../shared/constants.js';

export class Badge {
  constructor(options) {
    this.options = options;
    this.element = null;
    this.state = 'idle'; // idle, loading, result, error
    this.thoughtTimeout = null;
  }

  /**
   * Inject the badge into the page
   */
  inject() {
    this.element = this.createElement();

    const { container, position } = this.options;
    if (!container) return;

    // Remove any existing VerifyAI badge in this container (avoid duplicates when observers re-run)
    container.querySelectorAll('.verifyai-badge').forEach((el) => {
      try {
        el.remove();
      } catch {
        // ignore
      }
    });

    if (position.insertBefore) {
      container.insertBefore(this.element, container.firstChild);
    } else {
      container.appendChild(this.element);
    }
  }

  /**
   * Create the badge element
   */
  createElement() {
    const badge = document.createElement('div');
    badge.className = 'verifyai-badge';
    badge.setAttribute('data-platform', this.options.platform);

    badge.innerHTML = `
      <div class="verifyai-badge-inner">
        <button class="verifyai-btn" title="Fact-check this video with VerifyAI">
          <svg class="verifyai-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 12l2 2 4-4"/>
            <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/>
          </svg>
          <span class="verifyai-btn-text">Verify</span>
        </button>

        <div class="verifyai-progress hidden">
          <div class="verifyai-progress-ring">
            <svg viewBox="0 0 36 36">
              <circle class="verifyai-progress-bg" cx="18" cy="18" r="16"/>
              <circle class="verifyai-progress-bar" cx="18" cy="18" r="16"/>
            </svg>
            <span class="verifyai-progress-text">0%</span>
          </div>
          <span class="verifyai-status-text">Queued</span>
        </div>

        <div class="verifyai-result hidden">
          <div class="verifyai-score">
            <span class="verifyai-score-value">0</span>
          </div>
          <span class="verifyai-verdict"></span>
        </div>

        <div class="verifyai-error hidden">
          <svg class="verifyai-icon-error" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="15" y1="9" x2="9" y2="15"/>
            <line x1="9" y1="9" x2="15" y2="15"/>
          </svg>
          <span class="verifyai-error-text">Error</span>
        </div>

        <div class="verifyai-tooltip hidden">
          <div class="verifyai-tooltip-content"></div>
          <div class="verifyai-tooltip-arrow"></div>
        </div>
      </div>

      <div class="verifyai-thought hidden">
        <div class="verifyai-thought-content"></div>
      </div>
    `;

    // Event listeners
    const btn = badge.querySelector('.verifyai-btn');
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (this.state === 'idle') {
        this.options.onFactCheck?.();
      }
    });

    // Click on result to open side panel
    const result = badge.querySelector('.verifyai-result');
    result.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      this.options.onOpenPanel?.();
    });

    // Tooltip on hover
    badge.addEventListener('mouseenter', () => {
      if (this.state === 'result') {
        this.showTooltip();
      }
    });

    badge.addEventListener('mouseleave', () => {
      this.hideTooltip();
    });

    return badge;
  }

  /**
   * Set loading state
   */
  setLoading(loading) {
    this.state = loading ? 'loading' : 'idle';

    const btn = this.element.querySelector('.verifyai-btn');
    const progress = this.element.querySelector('.verifyai-progress');
    const result = this.element.querySelector('.verifyai-result');
    const error = this.element.querySelector('.verifyai-error');

    btn.classList.toggle('hidden', loading);
    progress.classList.toggle('hidden', !loading);
    result.classList.add('hidden');
    error.classList.add('hidden');

    if (loading) {
      this.updateProgress(0, 'queued');
    }
  }

  /**
   * Update progress display
   */
  updateProgress(progress, status) {
    const progressBar = this.element.querySelector('.verifyai-progress-bar');
    const progressText = this.element.querySelector('.verifyai-progress-text');
    const statusText = this.element.querySelector('.verifyai-status-text');

    // Update circular progress
    const circumference = 2 * Math.PI * 16;
    const offset = circumference - (progress / 100) * circumference;
    progressBar.style.strokeDashoffset = offset;

    progressText.textContent = `${progress}%`;
    statusText.textContent = STATUS_LABELS[status] || status;
  }

  /**
   * Show result
   */
  showResult(report) {
    this.state = 'result';
    this.report = report;

    const btn = this.element.querySelector('.verifyai-btn');
    const progress = this.element.querySelector('.verifyai-progress');
    const result = this.element.querySelector('.verifyai-result');
    const error = this.element.querySelector('.verifyai-error');
    const thought = this.element.querySelector('.verifyai-thought');

    btn.classList.add('hidden');
    progress.classList.add('hidden');
    result.classList.remove('hidden');
    error.classList.add('hidden');
    thought.classList.add('hidden');

    const scoreValue = result.querySelector('.verifyai-score-value');
    const scoreEl = result.querySelector('.verifyai-score');
    const verdictEl = result.querySelector('.verifyai-verdict');

    const score = report.overall_score;
    const verdict = report.overall_verdict;

    scoreValue.textContent = score;
    scoreEl.style.backgroundColor = getScoreColor(score);
    verdictEl.textContent = VERDICT_LABELS[verdict] || verdict;
    verdictEl.style.color = getVerdictColor(verdict);
  }

  /**
   * Show error state
   */
  showError(message) {
    this.state = 'error';

    const btn = this.element.querySelector('.verifyai-btn');
    const progress = this.element.querySelector('.verifyai-progress');
    const result = this.element.querySelector('.verifyai-result');
    const error = this.element.querySelector('.verifyai-error');
    const thought = this.element.querySelector('.verifyai-thought');
    const errorText = error.querySelector('.verifyai-error-text');

    btn.classList.add('hidden');
    progress.classList.add('hidden');
    result.classList.add('hidden');
    error.classList.remove('hidden');
    thought.classList.add('hidden');

    errorText.textContent = message || 'Error';
    errorText.title = message || 'Error';

    // Auto-reset after 5 seconds
    setTimeout(() => {
      if (this.state === 'error') {
        this.reset();
      }
    }, 5000);
  }

  /**
   * Show thought summary briefly
   */
  showThought(thought) {
    if (!thought) return;

    const thoughtEl = this.element.querySelector('.verifyai-thought');
    const contentEl = thoughtEl.querySelector('.verifyai-thought-content');

    // Truncate long thoughts
    const truncated = thought.length > 100 ? thought.slice(0, 100) + '...' : thought;
    contentEl.textContent = truncated;
    thoughtEl.classList.remove('hidden');

    // Clear any existing timeout
    if (this.thoughtTimeout) {
      clearTimeout(this.thoughtTimeout);
    }

    // Hide after 4 seconds
    this.thoughtTimeout = setTimeout(() => {
      thoughtEl.classList.add('hidden');
    }, 4000);
  }

  /**
   * Show cache indicator
   */
  showCacheIndicator() {
    const statusText = this.element.querySelector('.verifyai-status-text');
    if (statusText) {
      statusText.textContent = 'Loading cached result...';
    }
  }

  /**
   * Show tooltip with result details
   */
  showTooltip() {
    if (!this.report) return;

    const tooltip = this.element.querySelector('.verifyai-tooltip');
    const content = tooltip.querySelector('.verifyai-tooltip-content');

    // Build tooltip content
    const summary = this.report.summary?.slice(0, 150) || '';
    const score = this.report.overall_score;
    const verdict = VERDICT_LABELS[this.report.overall_verdict] || this.report.overall_verdict;

    content.innerHTML = `
      <div class="verifyai-tooltip-header">
        <span class="verifyai-tooltip-score" style="color: ${getScoreColor(score)}">${score}%</span>
        <span class="verifyai-tooltip-verdict">${verdict}</span>
      </div>
      <p class="verifyai-tooltip-summary">${summary}${summary.length >= 150 ? '...' : ''}</p>
      <span class="verifyai-tooltip-cta">Click for full report</span>
    `;

    tooltip.classList.remove('hidden');
  }

  /**
   * Hide tooltip
   */
  hideTooltip() {
    const tooltip = this.element.querySelector('.verifyai-tooltip');
    tooltip.classList.add('hidden');
  }

  /**
   * Reset to idle state
   */
  reset() {
    this.state = 'idle';
    this.report = null;

    const btn = this.element.querySelector('.verifyai-btn');
    const progress = this.element.querySelector('.verifyai-progress');
    const result = this.element.querySelector('.verifyai-result');
    const error = this.element.querySelector('.verifyai-error');
    const thought = this.element.querySelector('.verifyai-thought');

    btn.classList.remove('hidden');
    progress.classList.add('hidden');
    result.classList.add('hidden');
    error.classList.add('hidden');
    thought.classList.add('hidden');
  }

  /**
   * Remove the badge from the page
   */
  remove() {
    if (this.thoughtTimeout) {
      clearTimeout(this.thoughtTimeout);
    }
    this.element?.remove();
    this.element = null;
  }
}
