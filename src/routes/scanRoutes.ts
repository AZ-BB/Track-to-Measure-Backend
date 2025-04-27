import express from 'express';
import { scanController } from '../controllers/scanController';

const router = express.Router();

/**
 * @route   POST /api/scan
 * @desc    Scan a URL for marketing tags
 * @access  Public
 */
router.post('/', scanController.scanUrl);

/**
 * @route   GET /api/scan/history
 * @desc    Get scan history
 * @access  Public
 */
router.get('/history', scanController.getScanHistory);

/**
 * @route   GET /api/scan/:id
 * @desc    Get scan result by ID
 * @access  Public
 */
router.get('/:id', scanController.getScanById);

export { router as scanRoutes }; 