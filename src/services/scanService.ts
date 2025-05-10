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
      
      // Monitor network requests to detect GA4
      const ga4Requests: Set<string> = new Set();
      page.on('request', request => {
        const url = request.url();
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
      });
      
      // Navigate to the URL
      await page.goto(normalizedUrl, { waitUntil: 'networkidle2' });
      
      // Wait a bit longer for dynamic tags to load
      console.log("Waiting for dynamic tags to load...");
      await new Promise(resolve => setTimeout(resolve, 8000));
      
      // Wait for any remaining network activity to settle
      try {
        await page.waitForNetworkIdle({ idleTime: 2000, timeout: 5000 }).catch(() => {
          console.log("Network activity timeout - continuing with scan");
        });
      } catch (e) {
        console.log("Error waiting for network idle:", e);
      }
      
      // Get domain from URL
      const domain = new URL(normalizedUrl).hostname;
      
      // Detect tags
      const tagResults = await this.detectTags(page, [...ga4Requests]);
      
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
  private async detectTags(page: Page, ga4Requests: string[]): Promise<TagResult[]> {
    const results: TagResult[] = [];
    
    // Detect Google Tag Manager
    const gtmResult = await this.detectGoogleTagManager(page);
    results.push(gtmResult);
    
    // Detect GA4
    const ga4Result = await this.detectGA4(page, [...ga4Requests]);
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
        
        // Also check for GTM initialization script (not just the loaded script)
        const hasGtmInit = document.documentElement.innerHTML.includes('googletagmanager.com/gtm.js?id=GTM-');
        
        // Check for GTM initialization function
        const hasGtmInitFunction = document.documentElement.innerHTML.includes('(window,document,\'script\',\'dataLayer\',\'GTM-');
        
        // Overall GTM presence
        const hasGtm = hasGtmScript || hasGtmInit || hasGtmInitFunction;
        
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
        
        // Get GTM IDs if present
        const gtmIds: string[] = [];
        if (hasGtm) {
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
          
          // Full HTML scan for GTM IDs if none found yet
          if (gtmIds.length === 0) {
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
        
        // Determine status based on GTM script and dataLayer presence - more lenient
        let status = 'Not Found';
        
        if (hasGtm) {
          if (gtmIds.length === 0) {
            status = 'Incomplete Setup'; // Script present but no GTM ID found
          } else if (!hasDataLayer && !hasGtmActivation) {
            status = 'Misconfigured'; // Script and ID present but no dataLayer or activation
          } else {
            status = 'Connected'; // Properly set up or sufficiently detected
          }
        }
        
        return {
          isPresent: hasGtm,
          ids: gtmIds,
          id: gtmIds.length > 0 ? gtmIds[0] : undefined,
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
        ids: gtmData.ids,
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
        
        // Look for destination scripts which often contain GA4 configurations
        const destinationScripts = document.querySelectorAll('script[src*="googletagmanager.com/gtag/destination"]');
        if (destinationScripts.length > 0) {
          console.log("Found destination scripts:", destinationScripts.length);
          destinationScripts.forEach(script => {
            const src = script.getAttribute('src');
            if (src) {
              // Check for GA4 IDs in the destination URL
              const ga4Match = src.match(/[?&]id=G-[A-Z0-9]+/);
              if (ga4Match) {
                const ga4Id = ga4Match[0].replace(/[?&]id=/, '');
                if (!ga4Ids.includes(ga4Id)) {
                  console.log("Found GA4 ID in destination script:", ga4Id);
                  ga4Ids.push(ga4Id);
                }
              }
            }
          });
        }
        
        // Check window.dataLayer for gtag config commands with G- IDs
        let hasProperConfig = false;
        if (window.dataLayer && Array.isArray(window.dataLayer)) {
          console.log("Examining dataLayer with", window.dataLayer.length, "items");
          
          for (const item of window.dataLayer) {
            try {
              // Check for config array format
              if (item && Array.isArray(item) && item.length >= 2 && item[0] === 'config' && typeof item[1] === 'string' && item[1].startsWith('G-')) {
                const ga4Id = item[1];
                if (!ga4Ids.includes(ga4Id)) {
                  console.log("Found GA4 ID in dataLayer config array:", ga4Id);
                  ga4Ids.push(ga4Id);
                  hasProperConfig = true;
                }
              }
              
              // Check for object format with send_to property
              if (item && typeof item === 'object' && !Array.isArray(item)) {
                // Check for config in event object
                if (item.event === 'gtag.config' && item['gtm.uniqueEventId'] && item.target && item.target.startsWith('G-')) {
                  const ga4Id = item.target;
                  if (!ga4Ids.includes(ga4Id)) {
                    console.log("Found GA4 ID in gtag.config event:", ga4Id);
                    ga4Ids.push(ga4Id);
                    hasProperConfig = true;
                  }
                }
                
                // Check for send_to property
                if (item.send_to && typeof item.send_to === 'string') {
                  const ga4Match = item.send_to.match(/G-[A-Z0-9]+/);
                  if (ga4Match) {
                    const ga4Id = ga4Match[0];
                    if (!ga4Ids.includes(ga4Id)) {
                      console.log("Found GA4 ID in send_to property:", ga4Id);
                      ga4Ids.push(ga4Id);
                      hasProperConfig = true;
                    }
                  }
                }
                
                // Check for custom format that some implementations use
                if (item.event && (item.event === 'pageview' || item.event === 'gtm.dom' || item.event === 'gtm.load' || item.event === 'gtm.js')) {
                  // Sometimes the GA4 ID might be in a nested property
                  const itemStr = JSON.stringify(item);
                  const ga4Matches = itemStr.match(/G-[A-Z0-9]+/g);
                  if (ga4Matches) {
                    ga4Matches.forEach(ga4Id => {
                      if (!ga4Ids.includes(ga4Id)) {
                        console.log("Found GA4 ID in event object:", ga4Id);
                        ga4Ids.push(ga4Id);
                        hasProperConfig = true;
                      }
                    });
                  }
                }
              }
            } catch (e) {
              console.log("Error processing dataLayer item:", e);
              // Continue processing other items even if one fails
            }
          }
        }
        
        // Check for direct gtag presence and calls
        const hasGtagFunction = typeof window.gtag === 'function';
        if (hasGtagFunction) {
          console.log("Found gtag function");
          hasProperConfig = true;
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
                  hasProperConfig = true;
                }
              }
            }
          });
        }
        
        // Determine status - network requests mean it's definitely connected
        let status = 'Not Found';
        if (networkIds.length > 0 || ga4Ids.length > 0) {
          // If we found GA4 IDs through the network or other methods, it's connected
          status = 'Connected';
          console.log("GA4 status: Connected with IDs:", ga4Ids);
        } else if (hasGa4Script || (hasGtm && document.documentElement.innerHTML.includes('google-analytics'))) {
          // If we see GA4 script or GTM with analytics references, it's at least incomplete
          status = 'Incomplete Setup';
          console.log("GA4 status: Incomplete Setup (script present but no IDs)");
        } else {
          console.log("GA4 status: Not Found");
        }
        
        // Special case for GTM implementation when we didn't find IDs but GTM is present
        if (status === 'Not Found' && hasGtm) {
          // Assume GA4 is likely present through GTM but not directly detectable
          // This is a fallback for difficult-to-detect implementations
          status = 'Incomplete Setup';
          console.log("GA4 status adjusted to Incomplete Setup due to GTM presence");
        }
        
        return {
          isPresent: ga4Ids.length > 0 || hasGa4Script || (status !== 'Not Found'),
          ids: ga4Ids,
          id: ga4Ids.length > 0 ? ga4Ids[0] : undefined,
          status,
          hasProperConfig: true // If we found IDs in network traffic, it's definitely configured properly
        };
      }, ga4Requests);
      
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
        id: ga4Data.id,
        ids: ga4Data.ids
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

        // Create array to store all found IDs
        const gadsIds: string[] = [];

        // Check for inline conversion script
        const scripts = Array.from(document.querySelectorAll('script'));
        for (const script of scripts) {
          if (script.textContent?.includes('google_conversion_id') || 
              script.textContent?.includes('AW-')) {
            const matchConvId = script.textContent.match(/google_conversion_id = (\d+)/);
            // Improved regex pattern to match AW tags with both numbers and letters
            const matchAwAll = Array.from(script.textContent.matchAll(/AW-[\w\d]+/g) || []) as RegExpMatchArray[];
            
            if (matchAwAll.length > 0) {
              matchAwAll.forEach(matchArr => {
                const awId = matchArr[0];
                if (awId && !gadsIds.includes(awId)) {
                  gadsIds.push(awId);
                }
              });
            }
            
            if (matchConvId && !gadsIds.includes(`AW-${matchConvId[1]}`)) {
              gadsIds.push(`AW-${matchConvId[1]}`);
            }
          }
        }

        // Full HTML scan for AW pattern
        const awHtmlMatches = Array.from(document.documentElement.innerHTML.matchAll(/AW-[\w\d]+/g) || []) as RegExpMatchArray[];
        if (awHtmlMatches.length > 0) {
          awHtmlMatches.forEach(matchArr => {
            const awId = matchArr[0];
            if (awId && !gadsIds.includes(awId)) {
              gadsIds.push(awId);
            }
          });
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
              (item['send_to'] && typeof item['send_to'] === 'string' && item['send_to'].toString().match(/AW-[\w\d]+/))
            ) {
              foundInDataLayer = true;
              // Extract AW- ID from send_to if it exists
              if (item['send_to'] && typeof item['send_to'] === 'string') {
                const sendToMatches = Array.from(item['send_to'].matchAll(/AW-[\w\d]+/g) || []) as RegExpMatchArray[];
                sendToMatches.forEach(matchArr => {
                  const awId = matchArr[0];
                  if (awId && !gadsIds.includes(awId)) {
                    gadsIds.push(awId);
                  }
                });
              }
            }
            
            // Look for GTM config that includes AW account
            if (item.gtm && item.gtm.tags) {
              const tags = item.gtm.tags;
              for (const tagId in tags) {
                const tag = tags[tagId];
                if (tag && tag.tagId && typeof tag.tagId === 'string') {
                  const tagMatches = Array.from(tag.tagId.matchAll(/AW-[\w\d]+/g) || []) as RegExpMatchArray[];
                  if (tagMatches.length > 0) {
                    foundInDataLayer = true;
                    tagMatches.forEach(matchArr => {
                      const awId = matchArr[0];
                      if (awId && !gadsIds.includes(awId)) {
                        gadsIds.push(awId);
                      }
                    });
                  }
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

        // More robust page content search for AW patterns
        let hasConversionInnerHTML = false;
        const awTagMatches = Array.from(document.documentElement.innerHTML.matchAll(/(?:gtag\([\'\"]config[\'\"],\s*[\'\"](AW-[\w\d]+)[\'\"]\))|(AW-[\w\d]+)/g) || []) as RegExpMatchArray[];
        
        if (awTagMatches.length > 0) {
          hasConversionInnerHTML = true;
          awTagMatches.forEach(matchArr => {
            const awId = matchArr[1] || matchArr[0];
            // Extract just the AW-XXXXX part if needed
            if (awId) {
              const idMatch = awId.match(/AW-[\w\d]+/);
              if (idMatch && idMatch[0] && !gadsIds.includes(idMatch[0])) {
                gadsIds.push(idMatch[0]);
              }
            }
          });
        }

        // Remove duplicates and filter out invalid matches
        const uniqueGadsIds = [...new Set(gadsIds)].filter(id => id.startsWith('AW-'));

        const isPresent = hasGads || uniqueGadsIds.length > 0 || foundInDataLayer || hasGtagAds || hasGoogleAdsGlobals || hasConversionInnerHTML;
        
        // Determine status - consider a tag with ID as Connected even without conversion events 
        // since conversions may not have fired during the scan
        let status = 'Not Found';
        if (isPresent) {
          if (uniqueGadsIds.length === 0) {
            status = 'Incomplete Setup'; // Script present but no conversion ID
          } else if (hasConversionEvent || hasGoogleAdsGlobals || hasGtagAds) {
            status = 'Connected'; // ID found with conversion capabilities
          } else {
            status = 'Partial'; // ID found but no clear conversion setup
          }
        }

        return {
          isPresent,
          ids: uniqueGadsIds,
          id: uniqueGadsIds.length > 0 ? uniqueGadsIds[0] : undefined,
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
                gadsData.status === 'Partial' ? 
                TagStatus.INCOMPLETE : 
                TagStatus.NOT_FOUND,
        id: gadsData.id,
        ids: gadsData.ids
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
        
        // Array to store all Meta Pixel IDs
        const pixelIds: string[] = [];
        
        // Check for fbq('init', 'XXXXXXXXXX') calls
        let hasInit = false;
        const scripts = Array.from(document.querySelectorAll('script'));
        for (const script of scripts) {
          if (script.textContent?.includes('fbq(') || script.textContent?.includes('_fbq.push')) {
            // Regular fbq init calls
            const fbqMatches = Array.from(script.textContent.matchAll(/fbq\s*\(\s*['"]init['"],\s*['"](\d+)['"]/g) || []) as RegExpMatchArray[];
            if (fbqMatches.length > 0) {
              hasInit = true;
              fbqMatches.forEach(matchArr => {
                if (matchArr[1] && !pixelIds.includes(matchArr[1])) {
                  pixelIds.push(matchArr[1]);
                }
              });
            }
            
            // Legacy _fbq.push init calls
            const fbqPushMatches = Array.from(script.textContent.matchAll(/_fbq.push\s*\(\s*\[\s*['"]init['"],\s*['"](\d+)['"]/g) || []) as RegExpMatchArray[];
            if (fbqPushMatches.length > 0) {
              hasInit = true;
              fbqPushMatches.forEach(matchArr => {
                if (matchArr[1] && !pixelIds.includes(matchArr[1])) {
                  pixelIds.push(matchArr[1]);
                }
              });
            }
          }
        }
        
        // Full HTML scan for pixel IDs
        const pixelRegex = /(?:fbq\(['"]init['"],\s*['"](\d+)['"])|(pixel_id=(\d+))/g;
        const pixelHtmlMatches = Array.from(document.documentElement.innerHTML.matchAll(pixelRegex) || []) as RegExpMatchArray[];
        if (pixelHtmlMatches.length > 0) {
          pixelHtmlMatches.forEach(matchArr => {
            const pixelId = matchArr[1] || matchArr[3];
            if (pixelId && !pixelIds.includes(pixelId)) {
              pixelIds.push(pixelId);
            }
          });
        }
        
        // Check for functional fbq
        const hasFbqFunction = typeof window.fbq === 'function';
        
        // Determine status
        let status = 'Not Found';
        if (hasMetaPixel) {
          if (pixelIds.length === 0) {
            status = 'Incomplete Setup'; // Meta Pixel script present but no Pixel ID
          } else if (!hasInit || !hasFbqFunction) {
            status = 'Misconfigured'; // ID found but not properly initialized
          } else {
            status = 'Connected'; // Everything is set up correctly
          }
        }
        
        return {
          isPresent: hasMetaPixel,
          ids: pixelIds,
          id: pixelIds.length > 0 ? pixelIds[0] : undefined,
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
        id: metaData.id,
        ids: metaData.ids
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