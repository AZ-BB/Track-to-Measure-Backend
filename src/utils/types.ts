// Marketing tag types
export enum TagType {
  GOOGLE_TAG_MANAGER = 'Google Tag Manager',
  GA4 = 'GA4',
  GOOGLE_ADS = 'Google Ads Conversion',
  META_PIXEL = 'Meta Pixel',
  LINKEDIN = 'LinkedIn Insight',
  PINTEREST = 'Pinterest Tag',
  SNAPCHAT = 'Snapchat Pixel',
  TWITTER = 'Twitter Pixel',
  TIKTOK = 'TikTok Pixel'
}

// Tag result interface
export interface TagResult {
  name: string;
  isPresent: boolean;
  id?: string;
  details?: string;
}

// Scan result interface
export interface ScanResult {
  url: string;
  domain: string;
  scanTime: string;
  tags: TagResult[];
  cms?: string;
  recommendations?: string[];
}

// PDF report options
export interface ReportOptions {
  includeRecommendations: boolean;
  includeCmsInfo: boolean;
  includeHeader: boolean;
  colorScheme?: 'default' | 'modern' | 'professional';
}

// Request to scan a URL
export interface ScanRequest {
  url: string;
  includeCmsDetection?: boolean;
}

// CMS detection result
export interface CmsResult {
  name: string;
  version?: string;
  confidence: number;
} 