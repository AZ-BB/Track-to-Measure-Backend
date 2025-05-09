import puppeteer, { Page, Browser } from 'puppeteer';
import { TagType, TagResult, ScanResult, CmsResult, TagStatus } from '../utils/types';
import BadRequest from '../middlewares/handlers/errors/BadRequest';

// Add window interface extension for marketing tracking globals
declare global {
  interface Window {
    dataLayer?: any[];
    fbq?: Function;
    _linkedin_data_partner_ids?: any;
    pintrk?: Function;
    gtag?: Function;
    google_trackConversion?: Function;
    google_conversion_id?: string | number;
    google_conversion_label?: string;
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
      throw new BadRequest('Invalid URL provided');
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
      throw new BadRequest(`Failed to scan URL: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
      // Check for GTM script and dataLayer
      const gtmData = await page.evaluate(() => {
        // Check for GTM script tag
        const hasGtmScript = document.querySelectorAll('script[src*="googletagmanager.com/gtm.js"]').length > 0 || 
                           document.querySelectorAll('iframe[src*="googletagmanager.com/ns.html"]').length > 0;
        
        // Check for dataLayer
        const hasDataLayer = typeof window.dataLayer !== "undefined" && Array.isArray(window.dataLayer);
        
        // Check for active dataLayer (has items)
        const hasActiveDataLayer = hasDataLayer && window.dataLayer && window.dataLayer.length > 0;
        
        // Check for GTM activation - look for gtm.js event
        let hasGtmActivation = false;
        if (hasActiveDataLayer && window.dataLayer) {
          hasGtmActivation = window.dataLayer.some(item => 
            item && typeof item === 'object' && item.event === 'gtm.js'
          );
        }
        
        // Get GTM ID if present
        let gtmId;
        if (hasGtmScript) {
          // Find script with GTM initialization
          const scripts = Array.from(document.querySelectorAll('script'));
          for (const script of scripts) {
            if (script.textContent?.includes('GTM-')) {
              const match = script.textContent.match(/GTM-[A-Z0-9]+/);
              if (match) {
                gtmId = match[0];
                break;
              }
            }
          }
          
          // Check for GTM ID in URL if not found in scripts
          if (!gtmId) {
            const gtmScripts = document.querySelectorAll('script[src*="googletagmanager.com/gtm.js"]');
            if (gtmScripts.length > 0) {
              const src = gtmScripts[0].getAttribute('src');
              if (src) {
                const match = src.match(/id=GTM-[A-Z0-9]+/);
                if (match) {
                  gtmId = match[0].replace('id=', '');
                }
              }
            }
          }
        }
        
        // Determine status based on GTM script and dataLayer presence
        let status = 'Not Found';
        
        if (hasGtmScript) {
          if (!gtmId) {
            status = 'Incomplete Setup'; // Script present but no GTM ID found
          } else if (!hasDataLayer) {
            status = 'Misconfigured'; // Script and ID present but no dataLayer
          } else if (!hasActiveDataLayer) {
            status = 'Misconfigured'; // dataLayer exists but has no data
          } else if (!hasGtmActivation) {
            status = 'Misconfigured'; // dataLayer has data but no GTM activation event
          } else {
            status = 'Connected'; // Everything is properly set up
          }
        }
        
        return {
          isPresent: hasGtmScript,
          id: gtmId,
          status,
          hasDataLayer,
          hasActiveEvents: hasGtmActivation
        };
      });
      
      return {
        name: TagType.GOOGLE_TAG_MANAGER,
        isPresent: gtmData.isPresent,
        status: gtmData.status === 'Connected' ? 
                TagStatus.CONNECTED : 
                gtmData.status === 'Misconfigured' ? 
                TagStatus.MISCONFIGURED : 
                gtmData.status === 'Incomplete Setup' ? 
                TagStatus.INCOMPLETE : 
                TagStatus.NOT_FOUND,
        id: gtmData.id,
        details: gtmData.status,
        dataLayer: gtmData.hasDataLayer
      };
    } catch (error) {
      console.error('Error detecting Google Tag Manager:', error);
      return {
        name: TagType.GOOGLE_TAG_MANAGER,
        isPresent: false,
        status: TagStatus.ERROR,
        details: 'Error during detection'
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
        let hasProperConfig = false;
        if (window.dataLayer && Array.isArray(window.dataLayer)) {
          for (const item of window.dataLayer) {
            if (item && item[0] === 'config' && typeof item[1] === 'string' && item[1].startsWith('G-')) {
              ga4Id = item[1];
              hasProperConfig = true;
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
        
        // Determine status
        let status = 'Not Found';
        if (hasGa4Script) {
          if (!ga4Id) {
            status = 'Incomplete Setup'; // GA4 script present but no Measurement ID
          } else if (!hasProperConfig) {
            status = 'Misconfigured'; // ID found but not properly configured in dataLayer
          } else {
            status = 'Connected'; // Everything is set up correctly
          }
        }
        
        return {
          isPresent: hasGa4Script,
          id: ga4Id,
          status,
          hasProperConfig
        };
      });
      
      return {
        name: TagType.GA4,
        isPresent: ga4Data.isPresent,
        status: ga4Data.status === 'Connected' ? 
                TagStatus.CONNECTED : 
                ga4Data.status === 'Misconfigured' ? 
                TagStatus.MISCONFIGURED : 
                ga4Data.status === 'Incomplete Setup' ? 
                TagStatus.INCOMPLETE : 
                TagStatus.NOT_FOUND,
        id: ga4Data.id
      };
    } catch (error) {
      console.error('Error detecting GA4:', error);
      return {
        name: TagType.GA4,
        isPresent: false,
        status: TagStatus.ERROR
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

        // Advanced dataLayer inspection for Google Ads conversions
        let foundInDataLayer = false;
        let hasConversionEvent = false;
        if (window.dataLayer && Array.isArray(window.dataLayer)) {
          for (const item of window.dataLayer) {
            // Skip if not an object
            if (!item || typeof item !== 'object') continue;
            
            // Check for direct conversion events
            if (
              (item['event'] && typeof item['event'] === 'string' && 
               (item['event'].toLowerCase().includes('conversion')))
            ) {
              hasConversionEvent = true;
            }
            
            if (
              (item['event'] && typeof item['event'] === 'string' && 
               (item['event'].toLowerCase().includes('conversion') || 
                item['event'].toLowerCase() === 'gtm.dom' || 
                item['event'].toLowerCase() === 'gtm.load' || 
                item['event'].toLowerCase() === 'gtm.js')) ||
              (item['send_to'] && typeof item['send_to'] === 'string' && item['send_to'].toString().startsWith('AW-'))
            ) {
              foundInDataLayer = true;
              if (item['send_to'] && typeof item['send_to'] === 'string' && item['send_to'].startsWith('AW-')) {
                gadsId = item['send_to'];
              }
            }
            
            // Look for GTM config that includes AW account
            if (item.gtm && item.gtm.tags) {
              const tags = item.gtm.tags;
              for (const tagId in tags) {
                const tag = tags[tagId];
                if (tag && tag.tagId && tag.tagId.toString().startsWith('AW-')) {
                  foundInDataLayer = true;
                  gadsId = tag.tagId;
                  break;
                }
              }
            }
          }
        }

        // Check for Google Ads global variables and function calls
        const hasGtagAds = typeof window.gtag === 'function';
        const hasGoogleAdsGlobals = !!(
          window.google_trackConversion || 
          window.google_conversion_id || 
          window.google_conversion_label
        );

        // Also check page content for visible conversion indicators
        const hasConversionInnerHTML = document.documentElement.innerHTML.includes('gtag(\'config\', \'AW-') ||
                                      document.documentElement.innerHTML.includes('AW-');

        const isPresent = hasGads || !!gadsId || foundInDataLayer || hasGtagAds || hasGoogleAdsGlobals || hasConversionInnerHTML;
        
        // Determine status
        let status = 'Not Found';
        if (isPresent) {
          if (!gadsId) {
            status = 'Incomplete Setup'; // Script present but no conversion ID
          } else if (!hasConversionEvent && !hasGoogleAdsGlobals) {
            status = 'Misconfigured'; // ID found but no conversion events or functions
          } else {
            status = 'Connected'; // Everything is set up correctly
          }
        }

        return {
          isPresent,
          id: gadsId,
          status
        };
      });

      return {
        name: TagType.GOOGLE_ADS,
        isPresent: gadsData.isPresent,
        status: gadsData.status === 'Connected' ? 
                TagStatus.CONNECTED : 
                gadsData.status === 'Misconfigured' ? 
                TagStatus.MISCONFIGURED : 
                gadsData.status === 'Incomplete Setup' ? 
                TagStatus.INCOMPLETE : 
                TagStatus.NOT_FOUND,
        id: gadsData.id
      };
    } catch (error) {
      console.error('Error detecting Google Ads:', error);
      return {
        name: TagType.GOOGLE_ADS,
        isPresent: false,
        status: TagStatus.ERROR
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
        let hasInit = false;
        const scripts = Array.from(document.querySelectorAll('script'));
        for (const script of scripts) {
          if (script.textContent?.includes('fbq(') || script.textContent?.includes('_fbq.push')) {
            const match = script.textContent.match(/fbq\s*\(\s*['"]init['"],\s*['"](\d+)['"]/);
            const matchPush = script.textContent.match(/_fbq.push\s*\(\s*\[\s*['"]init['"],\s*['"](\d+)['"]/);
            
            pixelId = match ? match[1] : matchPush ? matchPush[1] : undefined;
            if (match || matchPush) hasInit = true;
            if (pixelId) break;
          }
        }
        
        // Check for functional fbq
        const hasFbqFunction = typeof window.fbq === 'function';
        
        // Determine status
        let status = 'Not Found';
        if (hasMetaPixel) {
          if (!pixelId) {
            status = 'Incomplete Setup'; // Meta Pixel script present but no Pixel ID
          } else if (!hasInit || !hasFbqFunction) {
            status = 'Misconfigured'; // ID found but not properly initialized
          } else {
            status = 'Connected'; // Everything is set up correctly
          }
        }
        
        return {
          isPresent: hasMetaPixel,
          id: pixelId,
          status
        };
      });
      
      return {
        name: TagType.META_PIXEL,
        isPresent: metaData.isPresent,
        status: metaData.status === 'Connected' ? 
                TagStatus.CONNECTED : 
                metaData.status === 'Misconfigured' ? 
                TagStatus.MISCONFIGURED : 
                metaData.status === 'Incomplete Setup' ? 
                TagStatus.INCOMPLETE : 
                TagStatus.NOT_FOUND,
        id: metaData.id
      };
    } catch (error) {
      console.error('Error detecting Meta Pixel:', error);
      return {
        name: TagType.META_PIXEL,
        isPresent: false,
        status: TagStatus.ERROR
      };
    }
  }
  
  /**
   * Detects LinkedIn Insight Tag
   */
  private async detectLinkedIn(page: Page): Promise<TagResult> {
    try {
      const linkedInData = await page.evaluate(() => {
        // Check for LinkedIn Insight Tag
        const hasScript = document.querySelector('script[src*="_linkedin_data_partner_id"]') !== null ||
                         document.querySelector('script[src*="snap.licdn.com"]') !== null;
        const hasGlobal = typeof window._linkedin_data_partner_ids !== 'undefined';
        const isPresent = hasScript || hasGlobal;
        
        // Determine status
        let status = 'Not Found';
        if (isPresent) {
          if (!hasGlobal) {
            status = 'Misconfigured'; // Script found but no partner IDs variable
          } else {
            status = 'Connected'; // Everything seems properly set up
          }
        }
        
        return {
          isPresent,
          status
        };
      });
      
      return {
        name: TagType.LINKEDIN,
        isPresent: linkedInData.isPresent,
        status: linkedInData.status === 'Connected' ? 
                TagStatus.CONNECTED : 
                linkedInData.status === 'Misconfigured' ? 
                TagStatus.MISCONFIGURED : 
                linkedInData.status === 'Incomplete Setup' ? 
                TagStatus.INCOMPLETE : 
                TagStatus.NOT_FOUND
      };
    } catch (error) {
      console.error('Error detecting LinkedIn Insight Tag:', error);
      return {
        name: TagType.LINKEDIN,
        isPresent: false,
        status: TagStatus.ERROR
      };
    }
  }
  
  /**
   * Detects Pinterest Tag
   */
  private async detectPinterest(page: Page): Promise<TagResult> {
    try {
      const pinterestData = await page.evaluate(() => {
        // Check for Pinterest Tag
        const hasScript = document.querySelector('script[src*="pintrk.js"]') !== null;
        const hasFunction = typeof window.pintrk === 'function';
        const isPresent = hasScript || hasFunction;
        
        // Determine status
        let status = 'Not Found';
        if (isPresent) {
          if (!hasFunction) {
            status = 'Misconfigured'; // Script found but function not available
          } else {
            status = 'Connected'; // Everything seems properly set up
          }
        }
        
        return {
          isPresent,
          status
        };
      });
      
      return {
        name: TagType.PINTEREST,
        isPresent: pinterestData.isPresent,
        status: pinterestData.status === 'Connected' ? 
                TagStatus.CONNECTED : 
                pinterestData.status === 'Misconfigured' ? 
                TagStatus.MISCONFIGURED : 
                pinterestData.status === 'Incomplete Setup' ? 
                TagStatus.INCOMPLETE : 
                TagStatus.NOT_FOUND
      };
    } catch (error) {
      console.error('Error detecting Pinterest Tag:', error);
      return {
        name: TagType.PINTEREST,
        isPresent: false,
        status: TagStatus.ERROR
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