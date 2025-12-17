/**
 * Shared constants for VerifyAI extension
 */

export const PLATFORMS = {
  YOUTUBE: {
    id: 'youtube',
    name: 'YouTube',
    patterns: [
      /youtube\.com\/watch/,
      /youtube\.com\/shorts\//,
      /youtu\.be\//,
    ],
    icon: 'youtube',
  },
  INSTAGRAM: {
    id: 'instagram',
    name: 'Instagram',
    patterns: [
      /instagram\.com\/p\//,
      /instagram\.com\/reel\//,
      /instagram\.com\/reels\//,
    ],
    icon: 'instagram',
  },
  TIKTOK: {
    id: 'tiktok',
    name: 'TikTok',
    patterns: [
      /tiktok\.com\/@[^/]+\/video/,
      /tiktok\.com\/t\//,
    ],
    icon: 'tiktok',
  },
  TWITTER: {
    id: 'twitter',
    name: 'X (Twitter)',
    patterns: [
      /twitter\.com\/[^/]+\/status/,
      /x\.com\/[^/]+\/status/,
    ],
    icon: 'twitter',
  },
  FACEBOOK: {
    id: 'facebook',
    name: 'Facebook',
    patterns: [
      /facebook\.com\/.*\/videos/,
      /facebook\.com\/watch/,
      /facebook\.com\/reel/,
      /fb\.watch\//,
    ],
    icon: 'facebook',
  },
};

export const JOB_STATUSES = {
  QUEUED: 'queued',
  FETCHING_TRANSCRIPT: 'fetching_transcript',
  DOWNLOADING: 'downloading',
  TRANSCRIBING: 'transcribing',
  FACT_CHECKING: 'fact_checking',
  TRANSLATING: 'translating',
  COMPLETED: 'completed',
  FAILED: 'failed',
};

export const STATUS_LABELS = {
  [JOB_STATUSES.QUEUED]: 'Queued',
  [JOB_STATUSES.FETCHING_TRANSCRIPT]: 'Fetching transcript',
  [JOB_STATUSES.DOWNLOADING]: 'Downloading',
  [JOB_STATUSES.TRANSCRIBING]: 'Transcribing',
  [JOB_STATUSES.FACT_CHECKING]: 'Analyzing',
  [JOB_STATUSES.TRANSLATING]: 'Translating',
  [JOB_STATUSES.COMPLETED]: 'Completed',
  [JOB_STATUSES.FAILED]: 'Failed',
};

export const OVERALL_VERDICTS = {
  ACCURATE: 'accurate',
  MOSTLY_ACCURATE: 'mostly_accurate',
  MIXED: 'mixed',
  MISLEADING: 'misleading',
  FALSE: 'false',
  UNVERIFIABLE: 'unverifiable',
};

export const VERDICT_LABELS = {
  [OVERALL_VERDICTS.ACCURATE]: 'Accurate',
  [OVERALL_VERDICTS.MOSTLY_ACCURATE]: 'Mostly Accurate',
  [OVERALL_VERDICTS.MIXED]: 'Mixed',
  [OVERALL_VERDICTS.MISLEADING]: 'Misleading',
  [OVERALL_VERDICTS.FALSE]: 'False',
  [OVERALL_VERDICTS.UNVERIFIABLE]: 'Unverifiable',
};

export const CLAIM_VERDICTS = {
  SUPPORTED: 'supported',
  CONTRADICTED: 'contradicted',
  MIXED: 'mixed',
  UNVERIFIABLE: 'unverifiable',
  NOT_FACTUAL: 'not_a_factual_claim',
};

export const CLAIM_VERDICT_LABELS = {
  [CLAIM_VERDICTS.SUPPORTED]: 'Supported',
  [CLAIM_VERDICTS.CONTRADICTED]: 'Contradicted',
  [CLAIM_VERDICTS.MIXED]: 'Mixed',
  [CLAIM_VERDICTS.UNVERIFIABLE]: 'Unverifiable',
  [CLAIM_VERDICTS.NOT_FACTUAL]: 'Not a factual claim',
};

export const DANGER_CATEGORIES = {
  MEDICAL: 'medical_misinformation',
  FINANCIAL: 'financial_scam',
  ILLEGAL: 'illegal_instructions',
  SELF_HARM: 'self_harm',
  DANGEROUS_CHALLENGE: 'dangerous_challenge',
  HATE: 'hate_or_harassment',
  PRIVACY: 'privacy_or_doxxing',
  OTHER: 'other',
};

export const SCORE_THRESHOLDS = {
  DANGER: 50,
  WARNING: 80,
};

export const SCORE_COLORS = {
  DANGER: '#ef4444',
  WARNING: '#f59e0b',
  SUCCESS: '#22c55e',
};

export function getScoreColor(score) {
  if (score < SCORE_THRESHOLDS.DANGER) return SCORE_COLORS.DANGER;
  if (score < SCORE_THRESHOLDS.WARNING) return SCORE_COLORS.WARNING;
  return SCORE_COLORS.SUCCESS;
}

export function getVerdictColor(verdict) {
  switch (verdict) {
    case OVERALL_VERDICTS.ACCURATE:
      return SCORE_COLORS.SUCCESS;
    case OVERALL_VERDICTS.MOSTLY_ACCURATE:
      return '#84cc16'; // lime
    case OVERALL_VERDICTS.MIXED:
      return SCORE_COLORS.WARNING;
    case OVERALL_VERDICTS.MISLEADING:
      return '#f97316'; // orange
    case OVERALL_VERDICTS.FALSE:
      return SCORE_COLORS.DANGER;
    case OVERALL_VERDICTS.UNVERIFIABLE:
      return '#6b7280'; // gray
    default:
      return '#6b7280';
  }
}

export const RTL_LANGUAGES = new Set(['ar', 'fa', 'he', 'ur']);

export const DEFAULT_SETTINGS = {
  backendMode: 'self-hosted',
  backendUrl: 'http://localhost:8000',
  language: 'en',
  autoDetectLanguage: false,
  badgePosition: 'player-controls',
  showThoughts: true,
  autoOpenPanel: false,
  enableLocalCache: true,
  cacheExpiryDays: 7,
};

export const POLL_INTERVAL_MS = 2000;

export const MESSAGE_TYPES = {
  // Content script -> Background
  START_FACT_CHECK: 'START_FACT_CHECK',
  GET_JOB_STATUS: 'GET_JOB_STATUS',
  GET_CACHED_RESULT: 'GET_CACHED_RESULT',
  GET_SETTINGS: 'GET_SETTINGS',
  OPEN_SIDE_PANEL: 'OPEN_SIDE_PANEL',

  // Background -> Content script / Side panel
  JOB_STARTED: 'JOB_STARTED',
  JOB_UPDATE: 'JOB_UPDATE',
  JOB_COMPLETED: 'JOB_COMPLETED',
  JOB_FAILED: 'JOB_FAILED',

  // Settings
  SETTINGS_UPDATED: 'SETTINGS_UPDATED',
};
