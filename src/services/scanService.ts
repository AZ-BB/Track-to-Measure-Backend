import puppeteer, { Page, Browser } from 'puppeteer';
import { TagType, TagResult, ScanResult, CmsResult } from '../utils/types';
import { AppError } from '../middlewares/errorHandler';

// Add window interface extension for marketing tracking globals
declare global {
  interface Window {
    dataLayer?: any[];
    fbq?: Function;
    _linkedin_data_partner_ids?: any;
    pintrk?: Function;
  }
}

/**
 * Service to scan websites for marketing tags
 */
export class ScanService {
  private browser: Browser | null = null;
  
  /**
   * Initialize the browser instance
   */
  private async getBrowser(): Promise<Browser> {
    if (!this.browser || !this.browser.isConnected()) {
      this.browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox', 
          '--disable-setuid-sandbox', 
          '--disable-dev-shm-usage',
          '--disable-features=IsolateOrigins,site-per-process',
          '--disable-web-security'
        ],
        defaultViewport: {
          width: 1366,
          height: 768
        }
      });
    }
    return this.browser;
  }

  /**
   * Scans a URL for marketing tags
   */
  async scanUrl(url: string, includeCmsDetection: boolean = false): Promise<ScanResult> {
    // Normalize URL (add https if missing)
    const normalizedUrl = this.normalizeUrl(url);
    
    // Validate URL
    if (!this.isValidUrl(normalizedUrl)) {
      throw new AppError('Invalid URL provided', 400);
    }
    
    let page: Page | null = null;
    
    try {
      // Get or create browser instance
      const browser = await this.getBrowser();
      
      // Create a new page
      page = await browser.newPage();
      
      // Set user agent to appear as a regular browser
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
      
      // Allow JavaScript execution
      await page.setJavaScriptEnabled(true);
      
      // Set timeout for navigation
      await page.setDefaultNavigationTimeout(30000);
      
      // Navigate to the URL
      await page.goto(normalizedUrl, { waitUntil: 'networkidle2' });
      
      // Wait a bit longer for dynamic tags to load
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Get domain from URL
      const domain = new URL(normalizedUrl).hostname;
      
      // Detect tags
      const tagResults = await this.detectTags(page);
      
      // Detect CMS if requested
      let cms: string | undefined;
      if (includeCmsDetection) {
        const cmsResult = await this.detectCms(page);
        cms = cmsResult?.name;
      }
      
      // Generate recommendations based on missing tags
      const recommendations = this.generateRecommendations(tagResults);
      
      // Close page but keep browser open
      await page.close();
      page = null;
      
      // Return scan result
      return {
        url: normalizedUrl,
        domain,
        scanTime: new Date().toISOString(),
        tags: tagResults,
        cms,
        recommendations
      };
    } catch (error) {
      console.error('Error scanning URL:', error);
      // Make sure to close the page if there's an error
      if (page) {
        try {
          await page.close();
        } catch (closeError) {
          console.error('Error closing page:', closeError);
        }
      }
      throw new AppError(`Failed to scan URL: ${error instanceof Error ? error.message : 'Unknown error'}`, 500);
    }
  }
  
  /**
   * Closes the browser instance when the service is shutting down
   */
  async closeBrowser(): Promise<void> {
    if (this.browser && this.browser.isConnected()) {
      await this.browser.close();
      this.browser = null;
    }
  }
  
  /**
   * Detects marketing tags on a page
   */
  private async detectTags(page: Page): Promise<TagResult[]> {
    const results: TagResult[] = [];
    
    // Detect Google Tag Manager
    const gtmResult = await this.detectGoogleTagManager(page);
    results.push(gtmResult);
    
    // Detect GA4
    const ga4Result = await this.detectGA4(page);
    results.push(ga4Result);
    
    // Detect Google Ads
    const gadsResult = await this.detectGoogleAds(page);
    results.push(gadsResult);
    
    // Detect Meta Pixel
    const metaResult = await this.detectMetaPixel(page);
    results.push(metaResult);
    
    // // Detect LinkedIn Insight
    // const linkedinResult = await this.detectLinkedIn(page);
    // results.push(linkedinResult);
    
    // // Detect Pinterest
    // const pinterestResult = await this.detectPinterest(page);
    // results.push(pinterestResult);
    
    return results;
  }
  
  /**
   * Detects Google Tag Manager
   */
  private async detectGoogleTagManager(page: Page): Promise<TagResult> {
    try {
      // Check for GTM script in page source
      const hasGtmScript = await page.evaluate(() => {
        // Check for GTM script tag
        const gtmScripts = document.querySelectorAll('script[src*="googletagmanager.com/gtm.js"]');
        const noscriptIframes = document.querySelectorAll('iframe[src*="googletagmanager.com/ns.html"]');
        return gtmScripts.length > 0 || noscriptIframes.length > 0;
      });
      console.log(hasGtmScript);
      // await new Promise(resolve => setTimeout(resolve, 1000000));
      // Get GTM ID if present
      let gtmId = undefined;
      if (hasGtmScript) {
        gtmId = await page.evaluate(() => {
          // Find script with GTM initialization
          const scripts = Array.from(document.querySelectorAll('script'));
          for (const script of scripts) {
            if (script.textContent?.includes('GTM-')) {
              const match = script.textContent.match(/GTM-[A-Z0-9]+/);
              return match ? match[0] : undefined;
            }
          }
          
          // Check for GTM ID in URL
          const gtmScripts = document.querySelectorAll('script[src*="googletagmanager.com/gtm.js"]');
          if (gtmScripts.length > 0) {
            const src = gtmScripts[0].getAttribute('src');
            if (src) {
              const match = src.match(/id=GTM-[A-Z0-9]+/);
              return match ? match[0].replace('id=', '') : undefined;
            }
          }
          
          return undefined;
        });
      }
      
      return {
        name: TagType.GOOGLE_TAG_MANAGER,
        isPresent: hasGtmScript,
        id: gtmId
      };
    } catch (error) {
      console.error('Error detecting Google Tag Manager:', error);
      return {
        name: TagType.GOOGLE_TAG_MANAGER,
        isPresent: false
      };
    }
  }
  
  /**
   * Detects Google Analytics 4
   */
  private async detectGA4(page: Page): Promise<TagResult> {
    try {
      // Check for GA4 script in page source
      const ga4Data = await page.evaluate(() => {
        // Check for GA4 script tag or gtag setup
        const hasGa4Script = document.querySelector('script[src*="google-analytics.com/analytics.js"]') !== null || 
                            document.querySelector('script[src*="googletagmanager.com/gtag/js"]') !== null;
        
        // Try to find GA4 ID
        let ga4Id;
        
        // Check window.dataLayer for gtag config commands with G- IDs
        if (window.dataLayer && Array.isArray(window.dataLayer)) {
          for (const item of window.dataLayer) {
            if (item && item[0] === 'config' && typeof item[1] === 'string' && item[1].startsWith('G-')) {
              ga4Id = item[1];
              break;
            }
          }
        }
        
        // Check for gtag script with GA4 ID
        if (!ga4Id) {
          const scripts = Array.from(document.querySelectorAll('script'));
          for (const script of scripts) {
            if (script.textContent?.includes('G-')) {
              const match = script.textContent.match(/G-[A-Z0-9]+/);
              if (match) {
                ga4Id = match[0];
                break;
              }
            }
          }
        }
        
        return {
          isPresent: hasGa4Script,
          id: ga4Id
        };
      });
      
      return {
        name: TagType.GA4,
        isPresent: ga4Data.isPresent,
        id: ga4Data.id
      };
    } catch (error) {
      console.error('Error detecting GA4:', error);
      return {
        name: TagType.GA4,
        isPresent: false
      };
    }
  }
  
  /**
   * Detects Google Ads Conversion tracking
   */
  private async detectGoogleAds(page: Page): Promise<TagResult> {
    try {
      const gadsData = await page.evaluate(() => {
        // Check for Google Ads conversion script or gtag setups
        const hasGads = document.querySelector('script[src*="googleadservices.com/pagead/conversion"]') !== null;
        
        // Try to find Google Ads ID
        let gadsId;
        
        // Check for inline conversion script
        const scripts = Array.from(document.querySelectorAll('script'));
        for (const script of scripts) {
          if (script.textContent?.includes('google_conversion_id') || 
              script.textContent?.includes('AW-')) {
            const matchConvId = script.textContent.match(/google_conversion_id = (\d+)/);
            const matchAw = script.textContent.match(/AW-\d+/);
            
            gadsId = matchAw ? matchAw[0] : matchConvId ? `AW-${matchConvId[1]}` : undefined;
            if (gadsId) break;
          }
        }
        
        return {
          isPresent: hasGads || !!gadsId,
          id: gadsId
        };
      });
      
      return {
        name: TagType.GOOGLE_ADS,
        isPresent: gadsData.isPresent,
        id: gadsData.id
      };
    } catch (error) {
      console.error('Error detecting Google Ads:', error);
      return {
        name: TagType.GOOGLE_ADS,
        isPresent: false
      };
    }
  }
  
  /**
   * Detects Meta (Facebook) Pixel
   */
  private async detectMetaPixel(page: Page): Promise<TagResult> {
    try {
      const metaData = await page.evaluate(() => {
        // Check for Meta Pixel script or fbq init
        const hasMetaPixel = 
          document.querySelector('script[src*="connect.facebook.net"]') !== null ||
          typeof window.fbq === 'function';
        
        // Try to find Meta Pixel ID
        let pixelId;
        
        // Check for fbq('init', 'XXXXXXXXXX') calls
        const scripts = Array.from(document.querySelectorAll('script'));
        for (const script of scripts) {
          if (script.textContent?.includes('fbq(') || script.textContent?.includes('_fbq.push')) {
            const match = script.textContent.match(/fbq\s*\(\s*['"]init['"],\s*['"](\d+)['"]/);
            const matchPush = script.textContent.match(/_fbq.push\s*\(\s*\[\s*['"]init['"],\s*['"](\d+)['"]/);
            
            pixelId = match ? match[1] : matchPush ? matchPush[1] : undefined;
            if (pixelId) break;
          }
        }
        
        return {
          isPresent: hasMetaPixel,
          id: pixelId
        };
      });
      
      return {
        name: TagType.META_PIXEL,
        isPresent: metaData.isPresent,
        id: metaData.id
      };
    } catch (error) {
      console.error('Error detecting Meta Pixel:', error);
      return {
        name: TagType.META_PIXEL,
        isPresent: false
      };
    }
  }
  
  /**
   * Detects LinkedIn Insight Tag
   */
  private async detectLinkedIn(page: Page): Promise<TagResult> {
    try {
      const isPresent = await page.evaluate(() => {
        // Check for LinkedIn Insight Tag
        return document.querySelector('script[src*="_linkedin_data_partner_id"]') !== null ||
               document.querySelector('script[src*="snap.licdn.com"]') !== null ||
               typeof window._linkedin_data_partner_ids !== 'undefined';
      });
      
      return {
        name: TagType.LINKEDIN,
        isPresent
      };
    } catch (error) {
      console.error('Error detecting LinkedIn Insight Tag:', error);
      return {
        name: TagType.LINKEDIN,
        isPresent: false
      };
    }
  }
  
  /**
   * Detects Pinterest Tag
   */
  private async detectPinterest(page: Page): Promise<TagResult> {
    try {
      const isPresent = await page.evaluate(() => {
        // Check for Pinterest Tag
        return document.querySelector('script[src*="pintrk.js"]') !== null ||
               typeof window.pintrk === 'function';
      });
      
      return {
        name: TagType.PINTEREST,
        isPresent
      };
    } catch (error) {
      console.error('Error detecting Pinterest Tag:', error);
      return {
        name: TagType.PINTEREST,
        isPresent: false
      };
    }
  }
  
  /**
   * Detects CMS used by the website
   */
  private async detectCms(page: Page): Promise<CmsResult | undefined> {
    try {
      return await page.evaluate(() => {
        // Check for common CMS signatures
        const html = document.documentElement.outerHTML;
        const metaTags = document.querySelectorAll('meta');
        
        // WordPress detection
        if (
          html.includes('/wp-content/') || 
          html.includes('/wp-includes/') || 
          document.querySelector('link[href*="wp-"]') !== null
        ) {
          return { name: 'WordPress', confidence: 0.9 };
        }
        
        // Shopify detection
        if (
          html.includes('cdn.shopify.com') || 
          html.includes('Shopify.theme')
        ) {
          return { name: 'Shopify', confidence: 0.9 };
        }
        
        // Wix detection
        if (
          html.includes('static.wixstatic.com') || 
          html.includes('wix-') || 
          document.querySelector('meta[name="generator"][content*="Wix"]') !== null
        ) {
          return { name: 'Wix', confidence: 0.9 };
        }
        
        // Drupal detection
        if (
          html.includes('drupal.') || 
          document.querySelector('meta[name="generator"][content*="Drupal"]') !== null
        ) {
          return { name: 'Drupal', confidence: 0.9 };
        }
        
        // Joomla detection
        if (
          html.includes('/media/jui/') || 
          document.querySelector('meta[name="generator"][content*="Joomla"]') !== null
        ) {
          return { name: 'Joomla', confidence: 0.9 };
        }
        
        // Check meta generator tags for other CMS
        for (const meta of metaTags) {
          if (meta.getAttribute('name') === 'generator') {
            const content = meta.getAttribute('content');
            if (content) {
              if (content.includes('WordPress')) {
                return { name: 'WordPress', confidence: 0.9 };
              }
              if (content.includes('Shopify')) {
                return { name: 'Shopify', confidence: 0.9 };
              }
              if (content.includes('Wix')) {
                return { name: 'Wix', confidence: 0.9 };
              }
              if (content.includes('Squarespace')) {
                return { name: 'Squarespace', confidence: 0.9 };
              }
              if (content.includes('Webflow')) {
                return { name: 'Webflow', confidence: 0.9 };
              }
              return { name: content.split(' ')[0], confidence: 0.7 };
            }
          }
        }
        
        return undefined;
      });
    } catch (error) {
      console.error('Error detecting CMS:', error);
      return undefined;
    }
  }
  
  /**
   * Generates recommendations based on missing tags
   */
  private generateRecommendations(tags: TagResult[]): string[] {
    const recommendations: string[] = [];
    
    // Check for Google Tag Manager first
    const hasGtm = tags.find(tag => tag.name === TagType.GOOGLE_TAG_MANAGER && tag.isPresent);
    
    // If GTM is missing, recommend it as the primary solution
    if (!hasGtm) {
      recommendations.push('Implement Google Tag Manager to centralize all your marketing tags in one place');
    }
    
    // Check for analytics
    const hasGa4 = tags.find(tag => tag.name === TagType.GA4 && tag.isPresent);
    if (!hasGa4) {
      recommendations.push(`${hasGtm ? 'Add' : 'Implement'} Google Analytics 4 to track website traffic and user behavior`);
    }
    
    // Check for Meta Pixel
    const hasMetaPixel = tags.find(tag => tag.name === TagType.META_PIXEL && tag.isPresent);
    if (!hasMetaPixel) {
      recommendations.push(`${hasGtm ? 'Add' : 'Implement'} Meta Pixel to track conversions from Facebook and Instagram ads`);
    }
    
    // Check for Google Ads
    const hasGads = tags.find(tag => tag.name === TagType.GOOGLE_ADS && tag.isPresent);
    if (!hasGads) {
      recommendations.push(`${hasGtm ? 'Add' : 'Implement'} Google Ads conversion tracking to optimize your ad campaigns`);
    }
    
    return recommendations;
  }
  
  /**
   * Validates if a string is a valid URL
   */
  private isValidUrl(urlString: string): boolean {
    try {
      const url = new URL(urlString);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch (error) {
      return false;
    }
  }
  
  /**
   * Normalizes a URL by adding https:// if missing
   */
  private normalizeUrl(url: string): string {
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return 'https://' + url;
    }
    return url;
  }
} 