import PDFDocument from 'pdfkit';
import { ScanResult, TagResult, ReportOptions } from '../utils/types';
import { AppError } from '../middlewares/errorHandler';

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
      this.addSummary(doc, scanResult, theme);
      this.addTagResults(doc, scanResult.tags, theme);
      
      if (options.includeRecommendations && scanResult.recommendations && scanResult.recommendations.length > 0) {
        this.addRecommendations(doc, scanResult.recommendations, theme);
      }
      
      if (options.includeCmsInfo && scanResult.cms) {
        this.addCmsInfo(doc, scanResult.cms, theme);
      }
      
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
      throw new AppError('Failed to generate PDF report', 500);
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
    // Add logo and title
    doc.fontSize(24)
       .fillColor(theme.primary)
       .text('TrackToMeasure', { align: 'center' })
       .fontSize(18)
       .fillColor(theme.text)
       .text('Marketing Tag Scan Report', { align: 'center' })
       .moveDown(0.5);
       
    // Add scan information
    doc.fontSize(12)
       .fillColor(theme.text)
       .text(`Website: ${scanResult.domain}`, { align: 'center' })
       .fillColor(theme.lightText)
       .text(`Scan Date: ${new Date(scanResult.scanTime).toLocaleString()}`, { align: 'center' })
       .moveDown(1);
       
    // Add horizontal line
    doc.strokeColor(theme.border)
       .lineWidth(1)
       .moveTo(50, doc.y)
       .lineTo(doc.page.width - 50, doc.y)
       .stroke()
       .moveDown(1);
  }
  
  /**
   * Adds summary to the PDF
   */
  private addSummary(doc: PDFKit.PDFDocument, scanResult: ScanResult, theme: any) {
    const presentTags = scanResult.tags.filter(tag => tag.isPresent).length;
    const totalTags = scanResult.tags.length;
    
    doc.fontSize(16)
       .fillColor(theme.text)
       .text('Summary', { underline: true })
       .moveDown(0.5);
       
    doc.fontSize(12)
       .fillColor(theme.text)
       .text(`Found ${presentTags} out of ${totalTags} marketing tags on your website.`, { continued: false })
       .moveDown(0.5);
       
    // Create a simple "gauge" to show progress
    const gaugeWidth = 400;
    const gaugeHeight = 24;
    const x = (doc.page.width - gaugeWidth) / 2;
    const y = doc.y;
    
    // Background
    doc.roundedRect(x, y, gaugeWidth, gaugeHeight, 4)
       .fillAndStroke('#E5E7EB', theme.border);
       
    // Progress bar
    const progressWidth = Math.max(4, (presentTags / totalTags) * gaugeWidth);
    const progressColor = presentTags === 0 ? theme.error :
                         presentTags < totalTags / 2 ? theme.warning :
                         theme.success;
                         
    doc.roundedRect(x, y, progressWidth, gaugeHeight, 4)
       .fill(progressColor);
       
    // Percentage
    const percentage = Math.round((presentTags / totalTags) * 100);
    doc.fontSize(12)
       .fillColor('#FFFFFF')
       .text(`${percentage}%`, x + progressWidth / 2 - 10, y + 5)
       .moveDown(2);
  }
  
  /**
   * Adds tag results to the PDF
   */
  private addTagResults(doc: PDFKit.PDFDocument, tags: TagResult[], theme: any) {
    doc.fontSize(16)
       .fillColor(theme.text)
       .text('Marketing Tags', { underline: true })
       .moveDown(0.5);
       
    // Create a table for tag results
    const startY = doc.y;
    const rowHeight = 40;
    const colWidths = [200, 100, 150];
    const tableWidth = colWidths.reduce((a, b) => a + b, 0);
    const startX = (doc.page.width - tableWidth) / 2;
    
    // Table header
    doc.fontSize(12)
       .fillColor('#FFFFFF')
       .rect(startX, startY, colWidths[0], rowHeight)
       .fill(theme.primary)
       .rect(startX + colWidths[0], startY, colWidths[1], rowHeight)
       .fill(theme.primary)
       .rect(startX + colWidths[0] + colWidths[1], startY, colWidths[2], rowHeight)
       .fill(theme.primary);
       
    doc.fillColor('#FFFFFF')
       .text('Tag Name', startX + 10, startY + 12)
       .text('Status', startX + colWidths[0] + 10, startY + 12)
       .text('ID/Details', startX + colWidths[0] + colWidths[1] + 10, startY + 12);
       
    // Table rows
    let currentY = startY + rowHeight;
    
    tags.forEach((tag, index) => {
      // Check if we need a new page
      if (currentY + rowHeight > doc.page.height - 100) {
        doc.addPage();
        currentY = 50;
      }
      
      const rowColor = index % 2 === 0 ? '#FFFFFF' : theme.background;
      
      // Row background
      doc.rect(startX, currentY, tableWidth, rowHeight)
         .fill(rowColor);
         
      // Add tag info
      doc.fillColor(theme.text)
         .text(tag.name, startX + 10, currentY + 12);
         
      // Tag status (with colored circle)
      const statusX = startX + colWidths[0] + 10;
      const statusY = currentY + 12;
      
      // Status circle
      doc.circle(statusX + 8, statusY + 8, 6)
         .fill(tag.isPresent ? theme.success : theme.error);
         
      // Status text
      doc.fillColor(theme.text)
         .text(tag.isPresent ? 'Detected' : 'Missing', statusX + 20, statusY);
         
      // Tag ID or details
      doc.fillColor(theme.lightText)
         .text(tag.id || '—', startX + colWidths[0] + colWidths[1] + 10, currentY + 12);
         
      // Border lines
      doc.strokeColor(theme.border)
         .lineWidth(0.5)
         .rect(startX, currentY, tableWidth, rowHeight)
         .stroke();
         
      currentY += rowHeight;
    });
    
    doc.moveDown(2);
  }
  
  /**
   * Adds recommendations to the PDF
   */
  private addRecommendations(doc: PDFKit.PDFDocument, recommendations: string[], theme: any) {
    doc.fontSize(16)
       .fillColor(theme.text)
       .text('Recommendations', { underline: true })
       .moveDown(0.5);
       
    // Background box
    const boxWidth = 450;
    const lineHeight = 22;
    const boxHeight = recommendations.length * lineHeight + 30;
    const boxX = (doc.page.width - boxWidth) / 2;
    const boxY = doc.y;
    
    doc.roundedRect(boxX, boxY, boxWidth, boxHeight, 4)
       .fillAndStroke('#F1F5F9', theme.border);
       
    // Add recommendations as bullet points
    doc.fontSize(12)
       .fillColor(theme.text);
       
    recommendations.forEach((recommendation, index) => {
      doc.text(`• ${recommendation}`, boxX + 20, boxY + 20 + (index * lineHeight));
    });
    
    doc.moveDown(2);
  }
  
  /**
   * Adds CMS information to the PDF
   */
  private addCmsInfo(doc: PDFKit.PDFDocument, cms: string, theme: any) {
    doc.fontSize(16)
       .fillColor(theme.text)
       .text('CMS Information', { underline: true })
       .moveDown(0.5);
       
    doc.fontSize(12)
       .fillColor(theme.text)
       .text(`Your website is built on: ${cms}`, { continued: false })
       .moveDown(2);
  }
  
  /**
   * Adds footer to the PDF
   */
  private addFooter(doc: PDFKit.PDFDocument, theme: any) {
    const pageCount = doc.bufferedPageRange().count;
    
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      
      // Footer text
      const text = `Generated by TrackToMeasure | Page ${i + 1} of ${pageCount}`;
      const textWidth = doc.widthOfString(text);
      const textX = (doc.page.width - textWidth) / 2;
      
      doc.fontSize(10)
         .fillColor(theme.lightText)
         .text(text, textX, doc.page.height - 50);
    }
  }
} 