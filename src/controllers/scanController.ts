import { Request, Response, NextFunction } from 'express';
import { ScanService } from '../services/scanService';
import { AppError } from '../middlewares/errorHandler';
import { ScanRequest } from '../utils/types';

// Instantiate the scan service
const scanService = new ScanService();

/**
 * Controller for handling website scanning operations
 */
export const scanController = {
  /**
   * Scan a URL for marketing tags
   */
  async scanUrl(req: Request, res: Response, next: NextFunction) {
    try {
      const { url, includeCmsDetection = false } = req.body as ScanRequest;
      
      // Validate input
      if (!url) {
        throw new AppError('URL is required', 400);
      }
      
      // Scan the URL
      const result = await scanService.scanUrl(url, includeCmsDetection);
      
      // Return scan results
      res.status(200).json({
        status: 'success',
        data: result
      });
    } catch (error) {
      next(error);
    }
  },
  
  /**
   * Get scan history (stub for future implementation)
   */
  async getScanHistory(req: Request, res: Response, next: NextFunction) {
    try {
      // This would typically fetch from a database
      // For now, just return a stub response
      res.status(200).json({
        status: 'success',
        message: 'Scan history feature coming soon',
        data: []
      });
    } catch (error) {
      next(error);
    }
  },
  
  /**
   * Get scan result by ID (stub for future implementation)
   */
  async getScanById(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      
      // This would typically fetch from a database
      // For now, just return a stub response
      if (!id) {
        throw new AppError('Scan ID is required', 400);
      }
      
      res.status(200).json({
        status: 'success',
        message: 'Scan retrieval feature coming soon',
        data: null
      });
    } catch (error) {
      next(error);
    }
  }
}; 