import PDFDocument from 'pdfkit';
import { ScanResult, TagResult, ReportOptions } from '../utils/types';
import BadRequest from '../middlewares/handlers/errors/BadRequest';

/**
 * Service to generate PDF reports from scan results
 */
export class ReportService {
  /**
   * Generates a PDF report from scan results
   */
  async generatePdfReport(
    scanResult: ScanResult,
    options: ReportOptions = {
      includeRecommendations: true,
      includeCmsInfo: true,
      includeHeader: true,
      colorScheme: 'default'
    }
  ): Promise<Buffer> {
    try {
      // Create a new PDF document
      const doc = new PDFDocument({
        margin: 50,
        size: 'A4',
        info: {
          Title: `Marketing Tag Report for ${scanResult.domain}`,
          Author: 'TrackToMeasure',
          Subject: 'Marketing Tag Analysis',
          Keywords: 'marketing, tags, analytics, gtm, ga4, pixel',
          Creator: 'TrackToMeasure PDF Generator',
          Producer: 'TrackToMeasure'
        }
      });
      
      // Buffer to store PDF data
      const chunks: Buffer[] = [];
      let result: Buffer;
      
      // Collect PDF data chunks
      doc.on('data', (chunk) => {
        chunks.push(chunk);
      });
      
      // When PDF is done being generated
      doc.on('end', () => {
        result = Buffer.concat(chunks);
      });
      
      // Set theme colors based on colorScheme
      const theme = this.getThemeColors(options.colorScheme || 'default');
      
      // Add content to PDF
      this.addHeader(doc, scanResult, theme);
      this.addTagResults(doc, scanResult.tags, theme);
      
      // Add bottom section with two columns
      this.addBottomSection(doc, scanResult, options, theme);
      
      this.addFooter(doc, theme);
      
      // Finalize the PDF
      doc.end();
      
      // Return a Promise that resolves with the PDF buffer
      return new Promise<Buffer>((resolve, reject) => {
        doc.on('end', () => {
          resolve(result);
        });
        
        doc.on('error', (error) => {
          reject(error);
        });
      });
    } catch (error) {
      console.error('Error generating PDF report:', error);
      throw new BadRequest('Failed to generate PDF report');
    }
  }
  
  /**
   * Gets theme colors based on color scheme
   */
  private getThemeColors(colorScheme: string) {
    switch (colorScheme) {
      case 'modern':
        return {
          primary: '#4F46E5',
          secondary: '#7C3AED',
          text: '#111827',
          lightText: '#6B7280',
          background: '#F9FAFB',
          success: '#10B981',
          error: '#EF4444',
          warning: '#F59E0B',
          border: '#D1D5DB'
        };
      case 'professional':
        return {
          primary: '#0F766E',
          secondary: '#155E75',
          text: '#1F2937',
          lightText: '#4B5563',
          background: '#F3F4F6',
          success: '#047857',
          error: '#B91C1C',
          warning: '#B45309',
          border: '#E5E7EB'
        };
      default:
        return {
          primary: '#2563EB',
          secondary: '#4F46E5',
          text: '#1F2937',
          lightText: '#6B7280',
          background: '#F8FAFC',
          success: '#16A34A',
          error: '#DC2626',
          warning: '#EA580C',
          border: '#E2E8F0'
        };
    }
  }
  
  /**
   * Adds header to the PDF
   */
  private addHeader(doc: PDFKit.PDFDocument, scanResult: ScanResult, theme: any) {
    // Calculate health score
    const presentTags = scanResult.tags.filter(tag => tag.isPresent).length;
    const totalTags = scanResult.tags.length;
    const healthScore = Math.round((presentTags / totalTags) * 100);
    
    // Main title - more compact
    doc.fontSize(24)
       .fillColor('#1F2937')
       .text('Website Tag Audit Report', 50, 40)
       .moveDown(0.5);
    
    // Two-column layout for subtitle and health score
    const leftColumnX = 50;
    const rightColumnX = 400;
    const currentY = doc.y;
    
    // Left column - domain and date
    doc.fontSize(13)
       .fillColor('#2563EB')
       .text(`for `, leftColumnX, currentY, { continued: true })
       .fillColor('#2563EB')
       .text(`${scanResult.domain}`, { continued: false })
       .fontSize(11)
       .fillColor('#6B7280')
       .text(`Audit date: ${new Date(scanResult.scanTime).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`, leftColumnX, doc.y + 3);
    
    // Right column - health score
    doc.fontSize(11)
       .fillColor('#6B7280')
       .text('Tracking', rightColumnX, currentY)
       .text('Health score', rightColumnX, currentY + 12)
       .fontSize(36)
       .fillColor('#2563EB')
       .text(`${healthScore}`, rightColumnX, currentY + 25);
       
    doc.moveDown(1.5);
  }
  

  
  /**
   * Adds tag results to the PDF
   */
  private addTagResults(doc: PDFKit.PDFDocument, tags: TagResult[], theme: any) {
    // Section title - more compact
    doc.fontSize(18)
       .fillColor('#1F2937')
       .text('Tag Detection Summary', 50, doc.y)
       .moveDown(0.5);
       
    // Container with border
    const containerX = 50;
    const containerWidth = 500;
    const startY = doc.y;
    
    // Calculate total height needed - make more compact
    let totalHeight = 0;
    tags.forEach(tag => {
      let rowHeight = 45; // Reduced base height
      // Add extra height for multiple IDs but keep compact
      if (tag.ids && tag.ids.length > 1) {
        rowHeight += (tag.ids.length - 1) * 12;
      }
      totalHeight += rowHeight;
    });
    
    // Draw container background and border
    doc.roundedRect(containerX, startY, containerWidth, totalHeight, 8)
       .fillAndStroke('#F9FAFB', '#D1D5DB');
    
    let currentY = startY + 15;
    
    tags.forEach((tag, index) => {
      // Calculate row height based on number of IDs - more compact
      let rowHeight = 45;
      if (tag.ids && tag.ids.length > 1) {
        rowHeight += (tag.ids.length - 1) * 12;
      }
      
      // Add border between rows (except for first row)
      if (index > 0) {
        doc.strokeColor('#D1D5DB')
           .lineWidth(1)
           .moveTo(containerX, currentY - 8)
           .lineTo(containerX + containerWidth, currentY - 8)
           .stroke();
      }
      
      // Tag icon area - smaller
      const iconX = containerX + 15;
      const iconY = currentY;
      this.drawTagIcon(doc, tag.name, iconX, iconY);
      
      // Tag name
      doc.fontSize(13)
         .fillColor('#1F2937')
         .text(tag.name, iconX + 40, iconY + 2);
      
      // Tag IDs (displayed below tag name in blue) - more compact
      const idsY = iconY + 18;
      if (tag.ids && tag.ids.length > 0) {
        tag.ids.forEach((id, idIndex) => {
          doc.fontSize(9)
             .fillColor('#2563EB')
             .text(`ID: ${id}`, iconX + 40, idsY + (idIndex * 12));
        });
      } else if (tag.id) {
        doc.fontSize(9)
           .fillColor('#2563EB')
           .text(`ID: ${tag.id}`, iconX + 40, idsY);
      }
      
      // Status on the right side
      const statusX = containerX + containerWidth - 90;
      const statusY = iconY + 8;
      
      if (tag.isPresent) {
        // Green checkmark circle
        doc.circle(statusX + 40, statusY, 7)
           .fill('#10B981');
           
        // Checkmark (simple approximation)
        doc.strokeColor('#FFFFFF')
           .lineWidth(2)
           .moveTo(statusX + 37, statusY)
           .lineTo(statusX + 39, statusY + 2)
           .lineTo(statusX + 43, statusY - 2)
           .stroke();
           
        // Status text
        doc.fontSize(11)
           .fillColor('#6B7280')
           .text('Installed', statusX - 15, statusY - 4);
      } else {
        // Red X circle
        doc.circle(statusX + 40, statusY, 7)
           .fill('#EF4444');
           
        // X mark
        doc.strokeColor('#FFFFFF')
           .lineWidth(2)
           .moveTo(statusX + 37, statusY - 3)
           .lineTo(statusX + 43, statusY + 3)
           .stroke()
           .moveTo(statusX + 43, statusY - 3)
           .lineTo(statusX + 37, statusY + 3)
           .stroke();
           
        // Status text
        doc.fontSize(11)
           .fillColor('#6B7280')
           .text('Not Found', statusX - 25, statusY - 4);
      }
      
      currentY += rowHeight;
    });
    
    doc.y = startY + totalHeight + 20;
  }
  
  /**
   * Adds bottom section with two columns
   */
  private addBottomSection(doc: PDFKit.PDFDocument, scanResult: ScanResult, options: ReportOptions, theme: any) {
    const leftColumnX = 50;
    const rightColumnX = 320;
    const columnWidth = 230;
    const startY = doc.y;
    
    // Left Column - Technology Detected (more compact)
    doc.fontSize(18)
       .fillColor('#1F2937')
       .text('Technology Detected', leftColumnX, startY);
    
    if (scanResult.cms) {
      // CMS detected with icon
      this.drawTagIcon(doc, 'CMS', leftColumnX, startY + 30);
      doc.fontSize(13)
         .fillColor('#1F2937')
         .text(scanResult.cms, leftColumnX + 40, startY + 35);
    } else {
      // No CMS detected - warning icon and text
      doc.circle(leftColumnX + 12, startY + 40, 10)
         .fill('#F59E0B');
         
      // Warning triangle
      doc.polygon([leftColumnX + 8, startY + 44], [leftColumnX + 16, startY + 44], [leftColumnX + 12, startY + 36])
         .fill('#FFFFFF');
      doc.fontSize(7)
         .fillColor('#F59E0B')
         .text('!', leftColumnX + 11, startY + 38);
         
      doc.fontSize(13)
         .fillColor('#1F2937')
         .text('No CMS detected', leftColumnX + 30, startY + 36);
    }
    
    // Right Column - Recommendations
    doc.fontSize(18)
       .fillColor('#1F2937')
       .text('Recommendations', rightColumnX, startY);
    
    if (options.includeRecommendations && scanResult.recommendations && scanResult.recommendations.length > 0) {
      let currentY = startY + 30;
      
      scanResult.recommendations.forEach((recommendation, index) => {
        // Green checkmark for positive recommendations, warning for issues
        const isPositive = recommendation.includes('properly configured');
        const iconColor = isPositive ? '#10B981' : '#F59E0B';
        
        doc.circle(rightColumnX + 6, currentY + 6, 6)
           .fill(iconColor);
           
        if (isPositive) {
          // Checkmark
          doc.strokeColor('#FFFFFF')
             .lineWidth(1.5)
             .moveTo(rightColumnX + 3, currentY + 6)
             .lineTo(rightColumnX + 5, currentY + 8)
             .lineTo(rightColumnX + 9, currentY + 4)
             .stroke();
        } else {
          // Warning triangle
          doc.polygon([rightColumnX + 3, currentY + 9], [rightColumnX + 9, currentY + 9], [rightColumnX + 6, currentY + 3])
             .fill('#FFFFFF');
        }
        
        // Recommendation text - more compact
        doc.fontSize(11)
           .fillColor('#1F2937')
           .text(recommendation, rightColumnX + 18, currentY + 2, {
             width: columnWidth - 18,
             align: 'left'
           });
           
        currentY += 25;
      });
    } else {
      // Default positive message
      doc.circle(rightColumnX + 6, startY + 36, 6)
         .fill('#10B981');
         
      // Checkmark
      doc.strokeColor('#FFFFFF')
         .lineWidth(1.5)
         .moveTo(rightColumnX + 3, startY + 36)
         .lineTo(rightColumnX + 5, startY + 38)
         .lineTo(rightColumnX + 9, startY + 34)
         .stroke();
         
      doc.fontSize(11)
         .fillColor('#1F2937')
         .text('All tags are properly configured!', rightColumnX + 18, startY + 32);
    }
    
    doc.y = startY + 80; // Much more compact spacing
  }
  
  /**
   * Draws tag icons
   */
  private drawTagIcon(doc: PDFKit.PDFDocument, tagName: string, x: number, y: number) {
    const iconSize = 32;
    
    // Draw background circle/square for icon
    doc.roundedRect(x, y, iconSize, iconSize, 4)
       .fill('#F3F4F6');
    
    // Simple icon representations based on tag type
    doc.fontSize(8)
       .fillColor('#6B7280');
       
    switch (tagName) {
      case 'Google Tag Manager':
        // GTM icon - simple "G" representation
        doc.circle(x + iconSize/2, y + iconSize/2, 12)
           .fill('#4285F4')
           .fontSize(12)
           .fillColor('#FFFFFF')
           .text('G', x + iconSize/2 - 4, y + iconSize/2 - 6);
        break;
      case 'GA4':
        // GA4 icon - analytics chart representation
        doc.rect(x + 8, y + 20, 4, 8)
           .fill('#FF9800')
           .rect(x + 14, y + 16, 4, 12)
           .fill('#FF9800')
           .rect(x + 20, y + 12, 4, 16)
           .fill('#FF9800');
        break;
      case 'Google Ads Conversion':
        // Ads icon - simple "Ad" representation
        doc.roundedRect(x + 6, y + 10, 20, 12, 2)
           .fill('#34A853')
           .fontSize(8)
           .fillColor('#FFFFFF')
           .text('Ad', x + 14, y + 14);
        break;
      case 'Meta Pixel':
        // Meta icon - "f" representation
        doc.circle(x + iconSize/2, y + iconSize/2, 12)
           .fill('#1877F2')
           .fontSize(12)
           .fillColor('#FFFFFF')
           .text('f', x + iconSize/2 - 3, y + iconSize/2 - 6);
        break;
      case 'CMS':
        // CMS icon - simple "CMS" representation
        doc.roundedRect(x + 4, y + 8, 24, 16, 2)
           .fill('#6366F1')
           .fontSize(7)
           .fillColor('#FFFFFF')
           .text('CMS', x + 11, y + 14);
        break;
      default:
        // Generic tag icon
        doc.fontSize(10)
           .fillColor('#6B7280')
           .text('TAG', x + 6, y + 12);
    }
  }

  /**
   * Adds footer to the PDF
   */
  private addFooter(doc: PDFKit.PDFDocument, theme: any) {
    // Simply add footer to current page
    const text = `Prepared by TrackToMeasure - Smart tools for marketers and freelancers`;
    const textWidth = doc.widthOfString(text);
    const textX = (doc.page.width - textWidth) / 2;
    
    doc.fontSize(10)
       .fillColor('#9CA3AF')
       .text(text, textX, doc.page.height - 50);
  }
} 