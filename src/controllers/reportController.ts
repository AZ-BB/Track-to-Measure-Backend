import { Request, Response, NextFunction } from 'express';
import { ReportService } from '../services/reportService';
import { ScanService } from '../services/scanService';
import { AppError } from '../middlewares/errorHandler';
import { ReportOptions } from '../utils/types';

// Instantiate services
const reportService = new ReportService();
const scanService = new ScanService();

/**
 * Controller for handling PDF report generation
 */
export const reportController = {
  /**
   * Generate a PDF report for a URL
   */
  async generateReport(req: Request, res: Response, next: NextFunction) {
    try {
      const { url, options } = req.body;
      
      // Validate input
      if (!url) {
        throw new AppError('URL is required', 400);
      }
      
      // Parse report options
      const reportOptions: ReportOptions = {
        includeRecommendations: options?.includeRecommendations ?? true,
        includeCmsInfo: options?.includeCmsInfo ?? true,
        includeHeader: options?.includeHeader ?? true,
        colorScheme: options?.colorScheme || 'default'
      };
      
      // First scan the URL
      const scanResult = await scanService.scanUrl(url, reportOptions.includeCmsInfo);
      
      // Generate PDF from scan results
      const pdfBuffer = await reportService.generatePdfReport(scanResult, reportOptions);
      
      // Set response headers for PDF download
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="tag-report-${scanResult.domain}.pdf"`);
      res.setHeader('Content-Length', pdfBuffer.length);
      
      // Send PDF as response
      res.send(pdfBuffer);
    } catch (error) {
      next(error);
    }
  },
  
  /**
   * Generate a PDF report from existing scan results
   */
  async generateReportFromScan(req: Request, res: Response, next: NextFunction) {
    try {
      const { scanResult, options } = req.body;
      
      // Validate input
      if (!scanResult) {
        throw new AppError('Scan result is required', 400);
      }
      
      // Parse report options
      const reportOptions: ReportOptions = {
        includeRecommendations: options?.includeRecommendations ?? true,
        includeCmsInfo: options?.includeCmsInfo ?? true,
        includeHeader: options?.includeHeader ?? true,
        colorScheme: options?.colorScheme || 'default'
      };
      
      // Generate PDF from scan results
      const pdfBuffer = await reportService.generatePdfReport(scanResult, reportOptions);
      
      // Set response headers for PDF download
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="tag-report-${scanResult.domain}.pdf"`);
      res.setHeader('Content-Length', pdfBuffer.length);
      
      // Send PDF as response
      res.send(pdfBuffer);
    } catch (error) {
      next(error);
    }
  },
  
  /**
   * Get report by ID (stub for future implementation)
   */
  async getReportById(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      
      if (!id) {
        throw new AppError('Report ID is required', 400);
      }
      
      // This would typically fetch from a database
      res.status(200).json({
        status: 'success',
        message: 'Report retrieval feature coming soon',
        data: null
      });
    } catch (error) {
      next(error);
    }
  }
}; 