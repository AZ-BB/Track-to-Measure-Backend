import express from 'express';
import { reportController } from '../controllers/reportController';

const router = express.Router();

/**
 * @route   POST /api/report/generate
 * @desc    Generate a PDF report for a URL
 * @access  Public
 */
router.post('/generate', reportController.generateReport);

/**
 * @route   POST /api/report/generate-from-scan
 * @desc    Generate a PDF report from existing scan results
 * @access  Public
 */
router.post('/generate-from-scan', reportController.generateReportFromScan);

/**
 * @route   GET /api/report/:id
 * @desc    Get report by ID
 * @access  Public
 */
router.get('/:id', reportController.getReportById);

export { router as reportRoutes }; 