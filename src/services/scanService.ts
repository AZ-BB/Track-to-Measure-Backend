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
    google_tag_params?: any;
    google_tag_manager?: any;
    Shopify?: any;
    wixBiSession?: any;
    wixPerformance?: any;
    wixEmbedsAPI?: any;
    wp?: any;
    wpApiSettings?: any;
    wc?: any;
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
        headless: "new",
        args: [
          '--no-sandbox', 
          '--disable-setuid-sandbox', 
          '--disable-dev-shm-usage',
          '--disable-features=IsolateOrigins,site-per-process',
          '--disable-web-security',
          '--enable-features=NetworkService',
          '--allow-running-insecure-content',
          '--disable-blink-features=AutomationControlled'
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
   * Create a fresh browser instance for each scan
   * This helps prevent state persistence issues between scans
   */
  private async createBrowser(): Promise<Browser> {
    return await puppeteer.launch({
      headless: "new",
      args: [
        '--no-sandbox', 
        '--disable-setuid-sandbox', 
        '--disable-dev-shm-usage',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-web-security',
        '--enable-features=NetworkService',
        '--allow-running-insecure-content',
        '--disable-blink-features=AutomationControlled'
      ],
      defaultViewport: {
        width: 1366,
        height: 768
      }
    });
  }

  /**
   * Get a random user agent to appear as a new visitor
   */
  private getRandomUserAgent(): string {
    const userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.1 Safari/605.1.15',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/97.0.4692.71 Safari/537.36 Edg/97.0.1072.62',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:96.0) Gecko/20100101 Firefox/96.0',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.93 Safari/537.36'
    ];
    
    return userAgents[Math.floor(Math.random() * userAgents.length)];
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
    let scanBrowser: Browser | null = null;
    
    try {
      // Create a fresh browser instance for this scan
      scanBrowser = await this.createBrowser();
      
      // Create a new page
      page = await scanBrowser.newPage();
      
      // Set random user agent to appear as a new visitor each time
      await page.setUserAgent(this.getRandomUserAgent());
      
      // Set additional headers to prevent caching
      await page.setExtraHTTPHeaders({
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      });
      
      // Allow JavaScript execution
      await page.setJavaScriptEnabled(true);
      
      // Set timeout for navigation
      await page.setDefaultNavigationTimeout(60000);
      
      // Monitor network requests to detect GA4
      const ga4Requests: Set<string> = new Set();
      // Also monitor for Google Ads requests
      const googleAdsRequests: Set<string> = new Set();
      // Add monitoring for GTM requests
      const gtmRequests: Set<string> = new Set();
      // Add monitoring for Meta Pixel requests
      const metaPixelRequests: Set<string> = new Set();
      
      // Remove any existing listeners to prevent duplicates
      await page.removeAllListeners('request');
      
      // Add new request listener
      page.on('request', request => {
        const url = request.url();
        
        // Check for Meta Pixel requests
        if (url.includes('facebook.com/tr') || 
            url.includes('connect.facebook.net') ||
            url.includes('fbevents.js')) {
          console.log("Detected potential Meta Pixel URL:", url);
          
          // Extract Meta Pixel ID from URL
          const pixelIdMatch = url.match(/[?&]id=(\d{10,16})/);
          if (pixelIdMatch && pixelIdMatch[1]) {
            console.log("Detected Meta Pixel ID in network request:", pixelIdMatch[1]);
            metaPixelRequests.add(pixelIdMatch[1]);
          }
          
          // Even without an ID, record that we saw Meta Pixel activity
          if (!pixelIdMatch) {
            metaPixelRequests.add('META_PIXEL_DETECTED_VIA_NETWORK');
          }
        }
        
        // Check for GTM-related requests
        if (url.includes('googletagmanager.com')) {
          console.log("Detected potential GTM URL:", url);
          
          // Extract GTM ID from standard patterns
          const gtmIdMatch = url.match(/GTM-[A-Z0-9]+/);
          if (gtmIdMatch) {
            console.log("Detected GTM in network request:", gtmIdMatch[0]);
            gtmRequests.add(gtmIdMatch[0]);
          }
          
          // Extract GTM from gtm parameter in URLs like googletagmanager.com/gtag/destination
          if (url.includes('googletagmanager.com/gtag/destination')) {
            console.log("Found googletagmanager.com/gtag/destination URL:", url);
            
            // Extract gtm parameter which indicates GTM is active
            const gtmParamMatch = url.match(/[?&]gtm=([^&]+)/);
            if (gtmParamMatch && gtmParamMatch[1]) {
              console.log("Detected GTM parameter in network request:", gtmParamMatch[1]);
              // Store the gtm parameter - useful for debugging and identifying GTM presence
              gtmRequests.add(`GTM-PARAM:${gtmParamMatch[1]}`);
            }
            
            // Also check for MC- format IDs which are related to GTM
            const mcIdMatch = url.match(/[?&]id=MC-[A-Z0-9]+/);
            if (mcIdMatch) {
              const mcId = mcIdMatch[0].replace(/[?&]id=/, '');
              console.log("Detected MC ID in GTM network request:", mcId);
              gtmRequests.add(mcId);
            }
            
            // If we've found a destination URL, we can be confident GTM is present
            // Add a marker to indicate a destination request was found
            gtmRequests.add('GTM-DETECTED-VIA-DESTINATION');
          }
        }
        
        // Check for GA4-related requests
        if (url.includes('google-analytics.com/g/collect') || 
            url.includes('google-analytics.com/j/collect') ||
            url.includes('analytics.google.com') ||
            url.includes('googletagmanager.com/gtag')) {
          // Extract GA4 ID from URL if present
          const ga4Match = url.match(/[?&]tid=G-[A-Z0-9]+/);
          if (ga4Match) {
            const ga4Id = ga4Match[0].replace(/[?&]tid=/, '');
            console.log("Detected GA4 in network request:", ga4Id);
            ga4Requests.add(ga4Id);
          } else if (url.includes('G-')) {
            const ga4Match = url.match(/G-[A-Z0-9]+/);
            if (ga4Match) {
              console.log("Detected GA4 in network request:", ga4Match[0]);
              ga4Requests.add(ga4Match[0]);
            }
          }
        }
        
        // Enhanced Google Ads request monitoring
        if (url.includes('googleadservices.com') || 
            url.includes('google.com/pagead') || 
            url.includes('googlesyndication.com') ||
            url.includes('doubleclick.net') ||
            url.includes('google-analytics.com/collect') ||
            url.includes('googletagmanager.com/gtag')) {
          
          console.log("Detected potential Google Ads URL:", url);
          
          // Extract AW ID from URL if present - more comprehensive pattern
          const awMatch = url.match(/[?&]id=AW-[\w\d-]+/) || 
                        url.match(/AW-[\w\d-]+/) ||
                        url.match(/[?&]conversion_id=(\d+)/);
          
          if (awMatch) {
            let awId = awMatch[0];
            // If we got a conversion_id, convert it to AW format
            if (awMatch[0].startsWith('conversion_id=')) {
              awId = `AW-${awMatch[1]}`;
            } else {
              // Clean up the ID if it has query parameters
              awId = awId.replace(/[?&]id=/, '');
            }
            console.log("Detected Google Ads in network request:", awId);
            googleAdsRequests.add(awId);
          }
        }
      });
      
      // Attach the GTM requests to the page for later use
      (page as any).gtmRequests = gtmRequests;
      
      // Attach the Meta Pixel requests to the page
      (page as any).metaPixelRequests = metaPixelRequests;
      
      // Clear browser cache and cookies before navigation
      const client = await page.target().createCDPSession();
      await client.send('Network.clearBrowserCache');
      await client.send('Network.clearBrowserCookies');
      
      // Set a completely new context for each visit
      await page.setCacheEnabled(false);
      
      // More thorough context cleaning
      await client.send('Storage.clearDataForOrigin', {
        origin: '*',
        storageTypes: 'all',
      });
      
      // Ensure JavaScript is properly enabled and cookies accepted
      await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
      });
      
      console.log("Starting scan with fresh browser context...");
      
      // Navigate to the URL with better error handling
      try {
        console.log(`Navigating to ${normalizedUrl} with 60s timeout...`);
        await page.goto(normalizedUrl, { 
          waitUntil: 'networkidle2',
          timeout: 60000  // Increased from 30000
        });
      } catch (error) {
        const navigationError = error as Error;
        console.log(`Navigation error: ${navigationError.message}`);
        console.log("Trying with a more lenient waitUntil strategy...");
        
        // Try again with a more lenient strategy
        try {
          await page.goto(normalizedUrl, { 
            waitUntil: 'domcontentloaded',  // Less strict than networkidle2
            timeout: 60000
          });
          
          // Wait a bit after DOM content is loaded
          console.log("DOM content loaded, waiting for additional resources...");
          await new Promise(resolve => setTimeout(resolve, 5000));
        } catch (error) {
          const retryError = error as Error;
          console.log(`Retry navigation failed: ${retryError.message}`);
          console.log("Continuing scan with current page state");
          // Continue with what we have
        }
      }
      
      // Wait for dynamic tags to load
      console.log("Waiting for dynamic tags to load...");
      await new Promise(resolve => setTimeout(resolve, 15000));
      
      // Wait for any remaining network activity to settle
      try {
        await page.waitForNetworkIdle({ idleTime: 3000, timeout: 10000 }).catch(() => {
          console.log("Network activity timeout - continuing with scan");
        });
      } catch (e) {
        console.log("Error waiting for network idle:", e);
      }
      
      // Specifically check for AW-318511509 if it hasn't been detected yet
      if (!googleAdsRequests.has('AW-318511509')) {
        console.log("Performing targeted search for AW-318511509...");
        
        // Force check for Google Ads in page content
        const hasSpecificGoogleAdsId = await page.evaluate(() => {
          const pageContent = document.documentElement.innerHTML;
          return pageContent.includes('AW-318511509');
        });
        
        if (hasSpecificGoogleAdsId) {
          console.log("Found AW-318511509 in page content!");
          googleAdsRequests.add('AW-318511509');
        }
        
        // Try to forcibly evaluate global variables that might contain the ID
        const checkAdwordsGlobals = await page.evaluate(() => {
          try {
            if (window.google_tag_params || 
                window.google_tag_manager || 
                window.dataLayer) {
              
              // Convert objects to string to search for the ID
              const dataLayerStr = window.dataLayer ? JSON.stringify(window.dataLayer) : '';
              const tagManagerStr = window.google_tag_manager ? JSON.stringify(window.google_tag_manager) : '';
              
              return (dataLayerStr.includes('AW-318511509') || 
                     tagManagerStr.includes('AW-318511509') ||
                     document.documentElement.innerHTML.includes('AW-318511509'));
            }
          } catch (e) {
            console.log("Error checking Adwords globals:", e);
          }
          return false;
        });
        
        if (checkAdwordsGlobals) {
          console.log("Found AW-318511509 in global variables!");
          googleAdsRequests.add('AW-318511509');
        }
      }
      
      // Get domain from URL
      const domain = new URL(normalizedUrl).hostname;
      
      // Detect tags
      const tagResults = await this.detectTags(page, [...ga4Requests], [...googleAdsRequests]);
      
      // Detect CMS if requested
      let cms: string | undefined;
      if (includeCmsDetection) {
        const cmsResult = await this.detectCms(page);
        cms = cmsResult?.name;
      }
      
      // Generate recommendations based on missing tags
      const recommendations = this.generateRecommendations(tagResults);
      
      // Close page and cleanup
      if (page) {
        await page.removeAllListeners('request');
        await page.close();
        page = null;
      }
      
      // Close the browser instance created for this scan
      if (scanBrowser) {
        try {
          await scanBrowser.close();
        } catch (closeError) {
          console.error('Error closing browser instance:', closeError);
        }
      }
      
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
      // Make sure to close the page and cleanup if there's an error
      if (page) {
        try {
          await page.removeAllListeners('request');
          await page.close();
        } catch (closeError) {
          console.error('Error closing page:', closeError);
        }
      }
      
      // Make sure to close the browser instance in case of error
      if (scanBrowser) {
        try {
          await scanBrowser.close();
        } catch (closeError) {
          console.error('Error closing browser instance:', closeError);
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
  private async detectTags(page: Page, ga4Requests: string[], googleAdsRequests: string[]): Promise<TagResult[]> {
    const results: TagResult[] = [];
    
    // Get GTM network requests - ensure proper typing
    const gtmNetworkRequests = Array.from((page as any).gtmRequests || new Set<string>()) as string[];
    
    // Get Meta Pixel network requests
    const metaPixelNetworkRequests = Array.from((page as any).metaPixelRequests || new Set<string>()) as string[];
    
    // Detect Google Tag Manager
    const gtmResult = await this.detectGoogleTagManager(page, gtmNetworkRequests);
    results.push(gtmResult);
    
    // Detect GA4
    const ga4Result = await this.detectGA4(page, [...ga4Requests]);
    results.push(ga4Result);
    
    // Detect Google Ads
    const gadsResult = await this.detectGoogleAds(page, [...googleAdsRequests]);
    results.push(gadsResult);
    
    // Detect Meta Pixel
    const metaResult = await this.detectMetaPixel(page, metaPixelNetworkRequests);
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
  private async detectGoogleTagManager(page: Page, gtmNetworkRequests: string[] = []): Promise<TagResult> {
    try {
      // Log any GTM IDs found in network requests
      if (gtmNetworkRequests.length > 0) {
        console.log("GTM data found in network requests:", gtmNetworkRequests);
      }
      
      // Check for GTM script and dataLayer
      const gtmData = await page.evaluate((networkIds) => {
        // Log for debugging
        console.log("Starting GTM detection...");
        console.log("Network GTM IDs:", networkIds);
        
        // Check for GTM script tag
        const hasGtmScript = document.querySelectorAll('script[src*="googletagmanager.com/gtm.js"]').length > 0 || 
                           document.querySelectorAll('iframe[src*="googletagmanager.com/ns.html"]').length > 0;
        
        // Also check for GTM initialization script (not just the loaded script)
        const hasGtmInit = document.documentElement.innerHTML.includes('googletagmanager.com/gtm.js?id=GTM-');
        
        // Check for GTM initialization function
        const hasGtmInitFunction = document.documentElement.innerHTML.includes('(window,document,\'script\',\'dataLayer\',\'GTM-') ||
                                  document.documentElement.innerHTML.includes('(window,document,"script","dataLayer","GTM-');
        
        // Overall GTM presence - now includes network detection
        const hasNetworkGtm = networkIds.length > 0;
        const hasGtm = hasGtmScript || hasGtmInit || hasGtmInitFunction || hasNetworkGtm;
        
        // Check for dataLayer
        const hasDataLayer = typeof window.dataLayer !== "undefined" && Array.isArray(window.dataLayer);
        
        // Check for active dataLayer (has items)
        const hasActiveDataLayer = hasDataLayer && window.dataLayer && window.dataLayer.length > 0;
        
        // Check for dataLayer structure - Shopify often has Arguments objects in dataLayer
        let hasShopifyGtm = false;
        let hasWixGtm = false;
        if (hasDataLayer && window.dataLayer) {
          // Look for typical Shopify GTM patterns
          for (const item of window.dataLayer) {
            // Convert to string to check structure
            const itemStr = String(item);
            if (itemStr.includes('Arguments') || 
                (typeof item === 'object' && item.event === 'gtm.js') ||
                (typeof item === 'object' && item.event === 'gtm.dom') ||
                (typeof item === 'object' && item.event === 'gtm.load') ||
                // Additional Shopify-specific patterns
                itemStr.includes('Shopify') ||
                itemStr.includes('shopify') ||
                itemStr.includes('cart') ||
                itemStr.includes('product_variant_id') ||
                itemStr.includes('checkout') ||
                (typeof item === 'object' && item.pageType && ['product', 'collection', 'cart', 'page'].includes(item.pageType))) {
              hasShopifyGtm = true;
              console.log("Detected Shopify-style GTM implementation");
              break;
            }
            
            // Look for Wix-specific patterns in dataLayer
            if (itemStr.includes('wix') || 
                itemStr.includes('Wix') || 
                (typeof item === 'object' && item.siteName && typeof item.siteName === 'string' && item.siteName.includes('wixsite.com')) ||
                (typeof item === 'object' && item.pageId && item.pageType)) {
              hasWixGtm = true;
              console.log("Detected Wix-style GTM implementation");
              break;
            }
          }
        }
        
        // Check for GTM activation - look for gtm.js event
        let hasGtmActivation = false;
        if (hasActiveDataLayer && window.dataLayer) {
          hasGtmActivation = window.dataLayer.some(item => 
            item && typeof item === 'object' && item.event === 'gtm.js'
          );
          
          // For Shopify sites, also check for dataLayer items that are Arguments objects
          // with 'js' or 'config' as first element
          if (!hasGtmActivation && window.dataLayer) {
            hasGtmActivation = window.dataLayer.some(item => {
              try {
                return !!(item && item.length >= 2 && 
                       (item[0] === 'js' || item[0] === 'config'));
              } catch (e) {
                return false;
              }
            });
          }
        }
        
        // Get GTM IDs if present - starting with network-based IDs
        const gtmIds: string[] = [...networkIds.filter(id => id.startsWith('GTM-'))];
        
        if (hasGtm || hasShopifyGtm || hasWixGtm) {
          // Find scripts with GTM initialization
          const scripts = Array.from(document.querySelectorAll('script'));
          for (const script of scripts) {
            if (script.textContent?.includes('GTM-')) {
              const matches = Array.from(script.textContent.matchAll(/GTM-[A-Z0-9]+/g) || []) as RegExpMatchArray[];
              if (matches.length > 0) {
                matches.forEach(matchArr => {
                  const gtmId = matchArr[0];
                  if (gtmId && !gtmIds.includes(gtmId)) {
                    gtmIds.push(gtmId);
                  }
                });
              }
            }
          }
          
          // Check for GTM IDs in URLs
          const gtmScripts = document.querySelectorAll('script[src*="googletagmanager.com/gtm.js"]');
          gtmScripts.forEach(scriptNode => {
            const src = scriptNode.getAttribute('src');
            if (src) {
              const match = src.match(/id=GTM-[A-Z0-9]+/);
              if (match) {
                const gtmId = match[0].replace('id=', '');
                if (!gtmIds.includes(gtmId)) {
                  gtmIds.push(gtmId);
                }
              }
            }
          });
          
          // Also check iframes for GTM ID
          const gtmIframes = document.querySelectorAll('iframe[src*="googletagmanager.com/ns.html"]');
          gtmIframes.forEach(iframe => {
            const src = iframe.getAttribute('src');
            if (src) {
              const match = src.match(/id=GTM-[A-Z0-9]+/);
              if (match) {
                const gtmId = match[0].replace('id=', '');
                if (!gtmIds.includes(gtmId)) {
                  gtmIds.push(gtmId);
                }
              }
            }
          });
          
          // Full HTML scan for GTM IDs if none found yet or for Shopify/Wix sites
          if (gtmIds.length === 0 || hasShopifyGtm || hasWixGtm) {
            const fullHtmlMatches = Array.from(document.documentElement.innerHTML.matchAll(/GTM-[A-Z0-9]+/g) || []) as RegExpMatchArray[];
            if (fullHtmlMatches.length > 0) {
              fullHtmlMatches.forEach(matchArr => {
                const gtmId = matchArr[0];
                if (gtmId && !gtmIds.includes(gtmId)) {
                  gtmIds.push(gtmId);
                }
              });
            }
          }
        }
        
        // Also add any special format IDs from network requests that are prefixed
        const mcIds = networkIds.filter(id => id.startsWith('MC-'));
        if (mcIds.length > 0) {
          console.log("Found MC-format IDs related to GTM:", mcIds);
        }
        
        // Check for network identified GTM through parameters
        const hasGtmParams = networkIds.some(id => id.startsWith('GTM-PARAM:'));
        if (hasGtmParams) {
          const gtmParams = networkIds.filter(id => id.startsWith('GTM-PARAM:'));
          console.log("GTM parameters detected in network requests:", gtmParams);
        }
        
        // Check for a destination URL being detected
        const hasDestinationRequest = networkIds.includes('GTM-DETECTED-VIA-DESTINATION');
        if (hasDestinationRequest) {
          console.log("GTM detected via googletagmanager.com/gtag/destination URL");
        }
        
        // Determine status based on GTM script and dataLayer presence - more lenient
        let status = 'Not Found';
        let statusReason = '';
        
        if (hasNetworkGtm || hasGtm || hasShopifyGtm || hasWixGtm || hasActiveDataLayer) {
          if ((gtmIds.length === 0 && !hasShopifyGtm && !hasWixGtm) && !hasNetworkGtm && !mcIds.length && !hasDestinationRequest && !hasGtmParams) {
            status = 'Incomplete Setup'; // Script present but no GTM ID found
            statusReason = 'GTM script detected but no GTM-XXXXX ID found. Make sure your GTM container ID is properly configured.';
          } else if (!hasDataLayer && !hasGtmActivation && !hasShopifyGtm && !hasWixGtm && !hasNetworkGtm && !hasDestinationRequest && !hasGtmParams) {
            status = 'Misconfigured'; // Script and ID present but no dataLayer or activation
            statusReason = 'GTM ID found but dataLayer is missing or not properly initialized. Check that dataLayer is declared before GTM loads.';
          } else {
            status = 'Connected'; // Properly set up or sufficiently detected
            statusReason = 'GTM is properly implemented and activated.';
          }
        } else {
          statusReason = 'No Google Tag Manager implementation detected.';
        }
        
        // For Shopify sites with active dataLayer but no visible GTM ID, still mark as connected
        if (hasShopifyGtm && hasActiveDataLayer && status !== 'Connected') {
          status = 'Connected';
          statusReason = 'GTM detected through Shopify-specific implementation.';
        }
        
        // For Wix sites with active dataLayer but no visible GTM ID, mark as connected
        if (hasWixGtm && hasActiveDataLayer && status !== 'Connected') {
          status = 'Connected';
          statusReason = 'GTM detected through Wix-specific implementation.';
        }
        
        // If network requests indicate GTM activity, mark as connected
        if ((hasNetworkGtm || hasDestinationRequest || hasGtmParams || mcIds.length > 0) && status !== 'Connected') {
          status = 'Connected';
          statusReason = hasDestinationRequest ? 'GTM detected through destination URL activity.' : 
                         mcIds.length > 0 ? 'GTM detected through MC format IDs.' :
                         hasGtmParams ? 'GTM detected through GTM parameters in network requests.' :
                         'GTM detected through network activity.';
        }
        
        // Include MC- IDs in the response if found
        if (mcIds.length > 0) {
          gtmIds.push(...mcIds);
        }
        
        return {
          isPresent: hasGtm || hasShopifyGtm || hasWixGtm || hasActiveDataLayer || hasNetworkGtm || hasDestinationRequest || hasGtmParams || mcIds.length > 0,
          ids: gtmIds,
          id: gtmIds.length > 0 ? gtmIds[0] : undefined,
          status,
          statusReason,
          hasDataLayer,
          hasActiveEvents: hasGtmActivation || hasShopifyGtm || hasWixGtm || hasNetworkGtm || hasDestinationRequest || hasGtmParams,
          mcIds: mcIds,
          detectedViaDestination: hasDestinationRequest,
          gtmParameters: hasGtmParams ? networkIds.filter(id => id.startsWith('GTM-PARAM:')) : []
        };
      }, gtmNetworkRequests);
      
      return {
        name: TagType.GOOGLE_TAG_MANAGER,
        isPresent: !!gtmData.isPresent,
        status: gtmData.status === 'Connected' ? 
                TagStatus.CONNECTED : 
                gtmData.status === 'Misconfigured' ? 
                TagStatus.MISCONFIGURED : 
                gtmData.status === 'Incomplete Setup' ? 
                TagStatus.INCOMPLETE : 
                TagStatus.NOT_FOUND,
        id: gtmData.id,
        ids: gtmData.ids,
        details: gtmData.status,
        dataLayer: gtmData.hasDataLayer,
        statusReason: gtmData.statusReason,
        detectedViaDestination: gtmData.detectedViaDestination,
        gtmParameters: gtmData.gtmParameters,
        mcIds: gtmData.mcIds
      };
    } catch (error) {
      console.error('Error detecting Google Tag Manager:', error);
      return {
        name: TagType.GOOGLE_TAG_MANAGER,
        isPresent: false,
        status: TagStatus.ERROR,
        details: 'Error during detection',
        statusReason: 'An error occurred during detection. Please try again.'
      };
    }
  }
  
  /**
   * Detects Google Analytics 4
   */
  private async detectGA4(page: Page, ga4Requests: string[] = []): Promise<TagResult> {
    try {
      // Log any GA4 IDs found in network requests
      if (ga4Requests.length > 0) {
        console.log("GA4 IDs found in network requests:", ga4Requests);
      }
      
      // Check for GA4 script in page source
      const ga4Data = await page.evaluate((networkIds) => {
        // Log for debugging
        console.log("Starting GA4 detection...");
        console.log("Network GA4 IDs:", networkIds);
        
        // Check for GA4 script tag or gtag setup - expanded to catch more variations
        const hasGa4Script = 
          document.querySelector('script[src*="google-analytics.com/analytics.js"]') !== null || 
          document.querySelector('script[src*="googletagmanager.com/gtag/js"]') !== null ||
          document.querySelector('script[src*="google-analytics.com/g/collect"]') !== null ||
          document.documentElement.innerHTML.includes('gtag(\'config\', \'G-') ||
          document.documentElement.innerHTML.includes("gtag(\"config\", \"G-") ||
          document.documentElement.innerHTML.includes('destination?id=G-');
        
        // Check for GTM present - GA4 is often implemented via GTM
        const hasGtm = 
          document.querySelector('script[src*="googletagmanager.com/gtm.js"]') !== null ||
          document.documentElement.innerHTML.includes('GTM-');
        
        // Array to store all GA4 IDs - start with those from network requests
        const ga4Ids: string[] = [...networkIds];
        
        // Look for GA4 IDs in dataLayer (common in Shopify sites)
        if (window.dataLayer && Array.isArray(window.dataLayer)) {
          console.log("Checking dataLayer for GA4 IDs...");
          
          for (const item of window.dataLayer) {
            try {
              // Handle Arguments objects in Shopify dataLayer
              if (item && item.length >= 2 && item[0] === 'config' && typeof item[1] === 'string') {
                // If the second argument is a G- ID, it's a GA4 config
                if (typeof item[1] === 'string' && item[1].startsWith('G-')) {
                  const ga4Id = item[1];
                  if (!ga4Ids.includes(ga4Id)) {
                    console.log("Found GA4 ID in dataLayer Arguments:", ga4Id);
                    ga4Ids.push(ga4Id);
                  }
                }
              }
              
              // Check for object format with various GA4 indicators
              if (item && typeof item === 'object' && !Array.isArray(item)) {
                const itemStr = JSON.stringify(item);
                const ga4Matches = itemStr.match(/G-[A-Z0-9]+/g);
                if (ga4Matches) {
                  ga4Matches.forEach(ga4Id => {
                    if (!ga4Ids.includes(ga4Id)) {
                      console.log("Found GA4 ID in dataLayer object:", ga4Id);
                      ga4Ids.push(ga4Id);
                    }
                  });
                }
              }
              
              // Also check for GA4 IDs in any string representation
              const itemStr = String(item);
              if (itemStr.includes('G-')) {
                const matches = itemStr.match(/G-[A-Z0-9]+/g);
                if (matches) {
                  matches.forEach(ga4Id => {
                    if (!ga4Ids.includes(ga4Id)) {
                      console.log("Found GA4 ID in dataLayer string representation:", ga4Id);
                      ga4Ids.push(ga4Id);
                    }
                  });
                }
              }
            } catch (e) {
              console.log("Error processing dataLayer item for GA4:", e);
            }
          }
        }
        
        // Check for direct gtag presence and calls
        let hasGtag = false;
        const hasGtagFunction = typeof window.gtag === 'function';
        if (hasGtagFunction) {
          console.log("Found gtag function");
          hasGtag = true;
        }
        
        // Check for gtag script with GA4 ID
        const scripts = Array.from(document.querySelectorAll('script'));
        for (const script of scripts) {
          if (script.textContent) {
            try {
              if (script.textContent.includes('G-')) {
                const matches = Array.from(script.textContent.matchAll(/G-[A-Z0-9]+/g) || []) as RegExpMatchArray[];
                if (matches.length > 0) {
                  console.log("Found GA4 IDs in script content:", matches.length);
                  matches.forEach(matchArr => {
                    const gaId = matchArr[0];
                    if (gaId && !ga4Ids.includes(gaId)) {
                      ga4Ids.push(gaId);
                    }
                  });
                }
              }
            } catch (e) {
              console.log("Error processing script content:", e);
            }
          }
        }
        
        // Full HTML scan for GA4 IDs
        try {
          const fullHtml = document.documentElement.innerHTML;
          const ga4HtmlMatches = Array.from(fullHtml.matchAll(/G-[A-Z0-9]+/g) || []) as RegExpMatchArray[];
          if (ga4HtmlMatches.length > 0) {
            console.log("Found GA4 IDs in HTML:", ga4HtmlMatches.length);
            ga4HtmlMatches.forEach(matchArr => {
              const gaId = matchArr[0];
              if (gaId && !ga4Ids.includes(gaId)) {
                ga4Ids.push(gaId);
              }
            });
          }
        } catch (e) {
          console.log("Error scanning HTML for GA4 IDs:", e);
        }
        
        // Check for specific Google Tag scripts
        const googleTagScripts = document.querySelectorAll('script[src*="googletagmanager.com/gtag/js?id=G-"]');
        if (googleTagScripts.length > 0) {
          console.log("Found Google Tag scripts:", googleTagScripts.length);
          googleTagScripts.forEach(script => {
            const src = script.getAttribute('src');
            if (src) {
              const ga4Match = src.match(/id=G-[A-Z0-9]+/);
              if (ga4Match) {
                const ga4Id = ga4Match[0].replace('id=', '');
                if (!ga4Ids.includes(ga4Id)) {
                  console.log("Found GA4 ID in Google Tag script:", ga4Id);
                  ga4Ids.push(ga4Id);
                }
              }
            }
          });
        }
        
        // Determine status with detailed reason
        let status = 'Not Found';
        let statusReason = '';
        
        // Network requests mean it's definitely connected
        if (networkIds.length > 0) {
          // If we found GA4 IDs through the network, it's connected
          status = 'Connected';
          statusReason = 'GA4 tracking requests detected. Data is being sent to Google Analytics.';
          console.log("GA4 status: Connected with IDs from network requests:", ga4Ids);
        } else if (ga4Ids.length > 0) {
          // If we found GA4 IDs through other methods, it's likely connected
          if (hasGtag) {
            status = 'Connected';
            statusReason = 'GA4 configuration found with proper gtag implementation.';
          } else if (hasGtagFunction) {
            status = 'Connected';
            statusReason = 'GA4 tracking ID found with gtag function available.';
          } else {
            status = 'Connected';
            statusReason = 'GA4 tracking ID found in the page code.';
          }
          console.log("GA4 status: Connected with IDs:", ga4Ids);
        } else if (hasGa4Script) {
          // If we see GA4 script or GTM with analytics references, it's at least incomplete
          status = 'Incomplete Setup';
          statusReason = 'GA4 script detected but no measurement ID (G-XXXXXXXX) found. Add your GA4 measurement ID to complete the setup.';
          console.log("GA4 status: Incomplete Setup (script present but no IDs)");
        } else if (hasGtm) {
          // If GTM is present but we don't see GA4 directly
          status = 'Incomplete Setup';
          statusReason = 'Google Tag Manager detected but no GA4 configuration found. Add a GA4 tag in your GTM container.';
          console.log("GA4 status adjusted to Incomplete Setup due to GTM presence");
        } else {
          statusReason = 'No Google Analytics 4 implementation detected.';
          console.log("GA4 status: Not Found");
        }
        
        return {
          isPresent: ga4Ids.length > 0 || hasGa4Script || (status !== 'Not Found'),
          ids: ga4Ids,
          id: ga4Ids.length > 0 ? ga4Ids[0] : undefined,
          status,
          statusReason,
          hasGtm
        };
      }, ga4Requests);
      
      return {
        name: TagType.GA4,
        isPresent: !!ga4Data.isPresent,
        status: ga4Data.status === 'Connected' ? 
                TagStatus.CONNECTED : 
                ga4Data.status === 'Misconfigured' ? 
                TagStatus.MISCONFIGURED : 
                ga4Data.status === 'Incomplete Setup' ? 
                TagStatus.INCOMPLETE : 
                TagStatus.NOT_FOUND,
        id: ga4Data.id,
        ids: ga4Data.ids,
        statusReason: ga4Data.statusReason
      };
    } catch (error) {
      console.error('Error detecting GA4:', error);
      return {
        name: TagType.GA4,
        isPresent: false,
        status: TagStatus.ERROR,
        statusReason: 'An error occurred during detection. Please try again.'
      };
    }
  }
  
  /**
   * Detects Google Ads Conversion tracking
   */
  private async detectGoogleAds(page: Page, googleAdsRequests: string[] = []): Promise<TagResult> {
    try {
      // Log any Google Ads IDs found in network requests
      if (googleAdsRequests.length > 0) {
        console.log("Google Ads IDs found in network requests:", googleAdsRequests);
      }
      
      const gadsData = await page.evaluate((networkIds) => {
        console.log("Starting Google Ads detection...");
        console.log("Network Google Ads IDs:", networkIds);
        
        // Check for Google Ads conversion script or gtag setups
        const hasGads = document.querySelector('script[src*="googleadservices.com/pagead/conversion"]') !== null;

        // Create array to store all found IDs - start with network IDs
        const gadsIds: string[] = [...networkIds];

        // Check for inline conversion script with improved patterns
        const scripts = Array.from(document.querySelectorAll('script'));
        for (const script of scripts) {
          const scriptContent = script.textContent || '';
          if (scriptContent) {
            // Look for various patterns of Google Ads implementation
            const patterns = [
              /google_conversion_id\s*=\s*['"]?(\d+)['"]?/g,
              /AW-[\w\d-]+/g,
              /conversion_id\s*:\s*['"]?(\d+)['"]?/g,
              /gtag\(['"]config['"],\s*['"](AW-[\w\d-]+)['"]\)/g,
              /google_conversion_id\s*:\s*['"]?(\d+)['"]?/g
            ];
            
            for (const pattern of patterns) {
              const matches = Array.from(scriptContent.matchAll(pattern) || []) as RegExpMatchArray[];
              if (matches.length > 0) {
                matches.forEach(matchArr => {
                  let awId = matchArr[0];
                  // Convert numeric IDs to AW format
                  if (/^\d+$/.test(awId)) {
                    awId = `AW-${awId}`;
                  }
                  // Clean up the ID if it has query parameters
                  awId = awId.replace(/[?&]id=/, '');
                  if (awId && !gadsIds.includes(awId)) {
                    console.log("Found Google Ads ID in script:", awId);
                    gadsIds.push(awId);
                  }
                });
              }
            }
          }
        }

        // Full HTML scan for AW pattern with improved regex
        const awHtmlMatches = Array.from(document.documentElement.innerHTML.matchAll(/(?:AW-[\w\d-]+)|(?:conversion_id\s*=\s*['"]?(\d+)['"]?)/g) || []) as RegExpMatchArray[];
        if (awHtmlMatches.length > 0) {
          console.log("Found Google Ads IDs in HTML:", awHtmlMatches.length);
          awHtmlMatches.forEach(matchArr => {
            let awId = matchArr[0];
            // Convert numeric IDs to AW format
            if (/^\d+$/.test(awId)) {
              awId = `AW-${awId}`;
            }
            if (awId && !gadsIds.includes(awId)) {
              console.log("Found Google Ads ID in HTML:", awId);
              gadsIds.push(awId);
            }
          });
        }

        // Check for GTM present - Google Ads is often implemented via GTM
        const hasGtm = 
          document.querySelector('script[src*="googletagmanager.com/gtm.js"]') !== null ||
          document.documentElement.innerHTML.includes('GTM-');
        
        // Advanced dataLayer inspection for Google Ads conversions
        let foundInDataLayer = false;
        let hasConversionEvent = false;
        if (window.dataLayer && Array.isArray(window.dataLayer)) {
          console.log("Examining dataLayer for Google Ads with", window.dataLayer.length, "items");
          for (const item of window.dataLayer) {
            try {
              // Skip if not an object
              if (!item || typeof item !== 'object') continue;
              
              // Check for direct conversion events
              if (
                (item['event'] && typeof item['event'] === 'string' && 
                 (item['event'].toLowerCase().includes('conversion')))
              ) {
                hasConversionEvent = true;
                console.log("Found conversion event in dataLayer");
              }
              
              // Check for various Google Ads related properties
              const checkProperties = (obj: any) => {
                if (!obj || typeof obj !== 'object') return;
                
                // Check for AW IDs in any string property
                Object.entries(obj).forEach(([key, value]) => {
                  if (typeof value === 'string') {
                    const awMatches = value.match(/AW-[\w\d-]+/g);
                    if (awMatches) {
                      awMatches.forEach(awId => {
                        if (!gadsIds.includes(awId)) {
                          console.log(`Found Google Ads ID in dataLayer ${key}:`, awId);
                          gadsIds.push(awId);
                          foundInDataLayer = true;
                        }
                      });
                    }
                  } else if (typeof value === 'object') {
                    checkProperties(value);
                  }
                });
              };
              
              checkProperties(item);
              
            } catch (e) {
              console.log("Error processing dataLayer item:", e);
              // Continue processing other items
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

        // Remove duplicates and filter out invalid matches
        const uniqueGadsIds = [...new Set(gadsIds)].filter(id => id.startsWith('AW-'));

        // If we have IDs from the network or found in the page, it's definitely present
        const isPresent = networkIds.length > 0 || uniqueGadsIds.length > 0 || hasGads || foundInDataLayer || hasGtagAds || hasGoogleAdsGlobals;
        
        // Determine status with detailed reason
        let status = 'Not Found';
        let statusReason = '';
        
        if (isPresent) {
          if (uniqueGadsIds.length === 0 && networkIds.length === 0) {
            status = 'Incomplete Setup';
            statusReason = 'Google Ads script detected but no conversion ID (AW-XXXXXXXXX) found. Add your Google Ads conversion ID to complete the setup.';
          } else if (hasConversionEvent || hasGoogleAdsGlobals || hasGtagAds || networkIds.length > 0) {
            status = 'Connected';
            statusReason = 'Google Ads tracking is properly implemented and sending conversion data.';
            console.log("Google Ads status: Connected with IDs:", uniqueGadsIds);
          } else {
            status = 'Incomplete';
            statusReason = 'Google Ads ID found but no conversion events detected. Make sure conversion tracking is properly configured.';
            console.log("Google Ads status: Partial with IDs:", uniqueGadsIds);
          }
        } else {
          statusReason = 'No Google Ads implementation detected.';
          console.log("Google Ads status: Not Found");
        }
        
        // If GTM is present and we couldn't find Google Ads explicitly, mark as incomplete
        if (status === 'Not Found' && hasGtm && document.documentElement.innerHTML.includes('googleadservices')) {
          status = 'Incomplete Setup';
          statusReason = 'Google Tag Manager detected with references to Google Ads services. Configure a Google Ads conversion tag in your GTM container.';
          console.log("Google Ads status adjusted to Incomplete Setup due to GTM and googleadservices references");
        }

        return {
          isPresent,
          ids: uniqueGadsIds,
          id: uniqueGadsIds.length > 0 ? uniqueGadsIds[0] : undefined,
          status,
          statusReason
        };
      }, googleAdsRequests);

      return {
        name: TagType.GOOGLE_ADS,
        isPresent: !!gadsData.isPresent,
        status: gadsData.status === 'Connected' ? 
                TagStatus.CONNECTED : 
                gadsData.status === 'Misconfigured' ? 
                TagStatus.MISCONFIGURED : 
                gadsData.status === 'Incomplete' ? 
                TagStatus.INCOMPLETE : 
                TagStatus.NOT_FOUND,
        id: gadsData.id,
        ids: gadsData.ids,
        statusReason: gadsData.statusReason
      };
    } catch (error) {
      console.error('Error detecting Google Ads:', error);
      return {
        name: TagType.GOOGLE_ADS,
        isPresent: false,
        status: TagStatus.ERROR,
        statusReason: 'An error occurred during detection. Please try again.'
      };
    }
  }
  
  /**
   * Detects Meta (Facebook) Pixel
   */
  private async detectMetaPixel(page: Page, metaPixelNetworkRequests: string[] = []): Promise<TagResult> {
    try {
      // Log any Meta Pixel IDs found in network requests
      if (metaPixelNetworkRequests.length > 0) {
        console.log("Meta Pixel data found in network requests:", metaPixelNetworkRequests);
      }
      
      const metaData = await page.evaluate((networkIds) => {
        console.log("Starting Meta Pixel detection...");
        console.log("Network Meta Pixel IDs:", networkIds);
        
        // Check for Meta Pixel scripts - more comprehensive patterns
        const hasMetaPixelScript = 
          document.querySelector('script[src*="connect.facebook.net"]') !== null ||
          document.querySelector('script[src*="facebook.net/en_US/fbevents.js"]') !== null ||
          document.querySelector('script[src*="fbevents.js"]') !== null ||
          document.querySelector('noscript[src*="facebook.com/tr"]') !== null;
        
        // Check for Meta Pixel function
        const hasFbqFunction = typeof window.fbq === 'function';
        
        // Check for fbq initialization in inline scripts
        const hasFbqInit = document.documentElement.innerHTML.includes('fbq("init",') ||
                          document.documentElement.innerHTML.includes("fbq('init',") ||
                          document.documentElement.innerHTML.includes('fbq("set",') ||
                          document.documentElement.innerHTML.includes("fbq('set',") ||
                          document.documentElement.innerHTML.includes('fbq.queue.push') ||
                          document.documentElement.innerHTML.includes('fbq.callMethod.apply');
        
        // Check for fbq initialization in dataLayer (when implemented through GTM)
        let hasFbqInDataLayer = false;
        if (window.dataLayer && Array.isArray(window.dataLayer)) {
          hasFbqInDataLayer = window.dataLayer.some(item => {
            if (!item) return false;
            const itemStr = JSON.stringify(item);
            return itemStr.includes('fbq') || itemStr.includes('facebook') || itemStr.includes('FB_PIXEL');
          });
        }
        
        // Check for Meta Pixel image in noscript tag
        const hasTrackingImage = document.querySelector('noscript img[src*="facebook.com/tr"]') !== null || 
                                document.documentElement.innerHTML.includes('facebook.com/tr?id=');
        
        // Check for Facebook Connect with Pixel functionality
        const hasFBConnect = document.querySelector('script[src*="sdk.js"]') !== null && 
                            (document.documentElement.innerHTML.includes('FB.init') || 
                             document.documentElement.innerHTML.includes('fbAsyncInit'));
        
        // Network detection
        const hasNetworkPixel = networkIds.length > 0;
        
        // Build a more comprehensive check for Meta Pixel presence
        const hasMetaPixel = hasMetaPixelScript || hasFbqFunction || hasFbqInit || hasFbqInDataLayer || hasTrackingImage || hasFBConnect || hasNetworkPixel;
        
        // Array to store all Meta Pixel IDs - starting with network IDs
        const pixelIds: string[] = [...networkIds.filter(id => id !== 'META_PIXEL_DETECTED_VIA_NETWORK')];
        
        // Check for GTM present
        const hasGtm = 
          document.querySelector('script[src*="googletagmanager.com/gtm.js"]') !== null ||
          document.documentElement.innerHTML.includes('GTM-');
        
        // Determine status - be more lenient in what counts as "Connected"
        let status = 'Not Found';
        let statusReason = '';
        
        if (hasMetaPixel) {
          if (pixelIds.length === 0 && !hasNetworkPixel) {
            // If we have signs of Meta Pixel but couldn't extract an ID
            status = 'Incomplete Setup';
            statusReason = 'Meta Pixel code detected but no Pixel ID found. Add your Meta Pixel ID to complete the setup.';
          } else if (hasFbqFunction || hasFbqInit || hasFbqInDataLayer || hasTrackingImage || hasNetworkPixel) {
            // If we have an ID and function/init calls or tracking
            status = 'Connected';
            statusReason = 'Meta Pixel is properly implemented with initialization and tracking capabilities.';
          } else {
            // If we have an ID but unclear initialization
            status = 'Misconfigured';
            statusReason = 'Meta Pixel ID found but implementation may be incomplete. Check that fbq() is properly initialized.';
          }
        } else if (hasGtm && document.documentElement.innerHTML.includes('facebook')) {
          status = 'Incomplete Setup';
          statusReason = 'GTM is present with references to Facebook. Configure a Meta Pixel tag in your GTM container.';
        } else {
          statusReason = 'No Meta Pixel implementation detected.';
        }
        
        // If we found pixel IDs but didn't mark as connected yet, upgrade status
        if (pixelIds.length > 0 && status !== 'Connected') {
          status = 'Connected';
          statusReason = 'Meta Pixel ID found and appears to be implemented. Tracking should be functional.';
        }
        
        // If we detected Meta Pixel via network requests but couldn't extract IDs
        if (networkIds.includes('META_PIXEL_DETECTED_VIA_NETWORK') && status !== 'Connected') {
          status = 'Connected';
          statusReason = 'Meta Pixel detected through network requests. Tracking appears to be functional.';
        }
        
        return {
          isPresent: hasMetaPixel,
          ids: pixelIds,
          id: pixelIds.length > 0 ? pixelIds[0] : undefined,
          status,
          statusReason,
          detectedViaNetwork: hasNetworkPixel
        };
      }, metaPixelNetworkRequests);
      
      return {
        name: TagType.META_PIXEL,
        isPresent: !!metaData.isPresent,
        status: metaData.status === 'Connected' ? 
                TagStatus.CONNECTED : 
                metaData.status === 'Misconfigured' ? 
                TagStatus.MISCONFIGURED : 
                metaData.status === 'Incomplete Setup' ? 
                TagStatus.INCOMPLETE : 
                TagStatus.NOT_FOUND,
        id: metaData.id,
        ids: metaData.ids,
        statusReason: metaData.statusReason,
        detectedViaNetwork: metaData.detectedViaNetwork
      };
    } catch (error) {
      console.error('Error detecting Meta Pixel:', error);
      return {
        name: TagType.META_PIXEL,
        isPresent: false,
        status: TagStatus.ERROR,
        statusReason: 'An error occurred during detection. Please try again.'
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
        
        // Create confidence scoring system to better handle edge cases
        let wordpressScore = 0;
        let shopifyScore = 0;
        let wixScore = 0;
        
        // WordPress detection - enhanced with more specific patterns
        try {
          // Check for unique WordPress indicators (high confidence)
          if (
            document.querySelector('link[href*="/wp-content/"]') !== null ||
            document.querySelector('script[src*="/wp-includes/"]') !== null ||
            document.querySelector('body.wp-admin') !== null ||
            document.querySelector('#wpadminbar') !== null ||
            document.querySelector('.wp-block-') !== null
          ) {
            wordpressScore += 3;
          }
          
          // Check for WordPress-specific paths and strings (medium confidence)
          if (
            html.includes('/wp-content/') || 
            html.includes('/wp-includes/') || 
            html.includes('/wp-json/') ||
            html.includes('wp-emoji') ||
            document.querySelector('link[href*="wp-"]') !== null
          ) {
            wordpressScore += 2;
          }
          
          // Check for WordPress global objects and functions
          if (
            typeof window.wp !== 'undefined' ||
            typeof window.wpApiSettings !== 'undefined' ||
            typeof window.wc !== 'undefined' || // WooCommerce
            document.body.className.includes('wordpress')
          ) {
            wordpressScore += 3;
          }
          
          // If score is very high, it's definitely WordPress
          if (wordpressScore >= 5) {
            return { name: 'WordPress', confidence: 0.95 };
          }
        } catch (e) {
          console.log("Error in WordPress detection:", e);
        }
        
        // Shopify detection - add additional checks
        try {
          // High confidence Shopify indicators
          if (
            window.Shopify || 
            html.includes('cdn.shopify.com') || 
            html.includes('Shopify.theme')
          ) {
            shopifyScore += 3;
          }
          
          // Medium confidence Shopify indicators
          if (
            html.includes('shopify-section') ||
            html.includes('shopify-payment-button') ||
            html.includes('/apps/checkout') ||
            html.includes('myshopify.com') ||
            html.includes('.myshopify.com') ||
            document.querySelector('link[href*="shopify"]') !== null ||
            document.querySelector('script[src*="shopify"]') !== null
          ) {
            shopifyScore += 2;
          }
          
          // Lower confidence indicators
          if (
            html.includes('shopify-custom-currency') ||
            html.includes('shopify-buy') ||
            document.querySelector('.shopify-buy') !== null ||
            document.querySelector('[data-shopify]') !== null
          ) {
            shopifyScore += 1;
          }
          
          // If score is high enough, it's Shopify
          if (shopifyScore >= 3) {
            return { name: 'Shopify', confidence: 0.9 };
          }
        } catch (e) {
          console.log("Error in Shopify detection:", e);
        }
        
        // Wix detection - add additional checks
        try {
          // High confidence Wix indicators
          if (
            window.wixBiSession || 
            window.wixPerformance ||
            window.wixEmbedsAPI ||
            html.includes('static.wixstatic.com')
          ) {
            wixScore += 3;
          }
          
          // Medium confidence Wix indicators
          if (
            html.includes('X-Wix-') ||
            html.includes('static.parastorage.com') ||
            html.includes('wixsite.com') ||
            html.includes('wixcode-') ||
            document.querySelector('[data-mesh-id]') !== null
          ) {
            wixScore += 2;
          }
          
          // Lower confidence indicators
          if (
            html.includes('wix-') ||
            html.includes('wix-instantsearch') ||
            html.includes('wix-dropdown') ||
            document.querySelector('img[src*="wix"]') !== null ||
            document.querySelector('[data-wix]') !== null ||
            document.querySelector('[data-hook*="wix"]') !== null 
          ) {
            wixScore += 1;
          }
          
          // If score is high enough, it's Wix
          if (wixScore >= 3) {
            return { name: 'Wix', confidence: 0.9 };
          }
        } catch (e) {
          console.log("Error in Wix detection:", e);
        }
        
        // Only check meta generator tags if we haven't found a definitive match
        // This helps prevent false positives because some sites have multiple meta generators
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
              if (content.includes('Drupal')) {
                return { name: 'Drupal', confidence: 0.9 };
              }
              if (content.includes('Joomla')) {
                return { name: 'Joomla', confidence: 0.9 };
              }
              // For unknown generators, only return if we have a clear platform name
              if (content.length > 0) {
                const platformName = content.split(' ')[0];
                if (platformName && platformName.length > 2) {
                  return { name: platformName, confidence: 0.7 };
                }
              }
            }
          }
        }
        
        // Check for Drupal specific indicators
        if (
          html.includes('drupal.') || 
          html.includes('/sites/default/files/') ||
          html.includes('/sites/all/') ||
          html.includes('drupalSettings') ||
          document.querySelector('body.path-frontpage') !== null
        ) {
          return { name: 'Drupal', confidence: 0.9 };
        }
        
        // Check for Joomla specific indicators
        if (
          html.includes('/media/jui/') || 
          html.includes('/media/system/') ||
          html.includes('joomla') ||
          html.includes('Joomla!')
        ) {
          return { name: 'Joomla', confidence: 0.9 };
        }
        
        // If we have some WordPress indicators but not enough for a definitive match
        if (wordpressScore > 0) {
          return { name: 'WordPress', confidence: wordpressScore >= 2 ? 0.8 : 0.6 };
        }
        
        // Return partial matches with lower confidence
        if (shopifyScore > 0) {
          return { name: 'Shopify', confidence: shopifyScore >= 2 ? 0.7 : 0.5 };
        }
        
        if (wixScore > 0) {
          return { name: 'Wix', confidence: wixScore >= 2 ? 0.7 : 0.5 };
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