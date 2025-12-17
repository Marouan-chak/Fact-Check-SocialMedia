/**
 * API client for VerifyAI backend communication
 */

import { getSettings } from '../shared/storage.js';

const DEFAULT_TIMEOUT = 30000;

/**
 * API Client for communicating with the VerifyAI backend
 */
export class ApiClient {
  constructor() {
    this.baseUrl = null;
    this.timeout = DEFAULT_TIMEOUT;
  }

  /**
   * Initialize the client with settings
   */
  async init() {
    const settings = await getSettings();
    this.baseUrl = settings.backendUrl.replace(/\/$/, '');
  }

  /**
   * Set the base URL
   * @param {string} url - Backend URL
   */
  setBaseUrl(url) {
    this.baseUrl = url.replace(/\/$/, '');
  }

  /**
   * Get the current base URL
   * @returns {string}
   */
  getBaseUrl() {
    return this.baseUrl;
  }

  /**
   * Check backend health
   * @returns {Promise<{status: string, version: string, supported_platforms: string[]}>}
   */
  async healthCheck() {
    return this.fetch('/api/health');
  }

  /**
   * Get backend configuration
   * @returns {Promise<{poll_interval_ms: number, supported_languages: Array, default_language: string}>}
   */
  async getConfig() {
    return this.fetch('/api/config');
  }

  /**
   * Submit a URL for fact-checking analysis
   * @param {string} url - Video URL to analyze
   * @param {string} outputLanguage - Output language code (default: 'ar')
   * @param {boolean} force - Force re-analysis even if cached
   * @returns {Promise<{job_id: string, cached: boolean, is_translation: boolean}>}
   */
  async analyze(url, outputLanguage = 'ar', force = false) {
    return this.fetch('/api/analyze', {
      method: 'POST',
      body: JSON.stringify({
        url,
        output_language: outputLanguage,
        force,
      }),
    });
  }

  /**
   * Get job status and results
   * @param {string} jobId - Job ID
   * @returns {Promise<Object>} Job object with status, progress, report, etc.
   */
  async getJob(jobId) {
    return this.fetch(`/api/jobs/${jobId}`);
  }

  /**
   * Get analysis history
   * @param {number} limit - Maximum number of items to return
   * @returns {Promise<Array>} List of history items
   */
  async getHistory(limit = 50) {
    return this.fetch(`/api/history?limit=${limit}`);
  }

  /**
   * Make a fetch request to the backend
   * @param {string} path - API path
   * @param {Object} options - Fetch options
   * @returns {Promise<any>} JSON response
   */
  async fetch(path, options = {}) {
    if (!this.baseUrl) {
      await this.init();
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...options,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          ...options.headers,
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new ApiError(
          errorData.detail || `Request failed: ${response.status}`,
          response.status,
          errorData
        );
      }

      return response.json();
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new ApiError('Request timeout', 0, null);
      }
      if (error instanceof ApiError) {
        throw error;
      }
      throw new ApiError(error.message, 0, null);
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

/**
 * Custom error class for API errors
 */
export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

// Singleton instance
let apiClientInstance = null;

/**
 * Get the singleton API client instance
 * @returns {ApiClient}
 */
export function getApiClient() {
  if (!apiClientInstance) {
    apiClientInstance = new ApiClient();
  }
  return apiClientInstance;
}
