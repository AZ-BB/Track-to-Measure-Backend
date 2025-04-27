import { Request, Response, NextFunction } from 'express';

// Define custom error class
export class AppError extends Error {
  statusCode: number;
  isOperational: boolean;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

// Error handling middleware
export const errorHandler = (
  err: Error | AppError,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  console.error('Error:', err);

  // Default error values
  let statusCode = 500;
  let message = 'Internal Server Error';
  let stack = process.env.NODE_ENV === 'production' ? undefined : err.stack;

  // If it's our AppError, use its statusCode and message
  if ('statusCode' in err) {
    statusCode = err.statusCode;
    message = err.message;
  }

  // Return error response
  res.status(statusCode).json({
    status: 'error',
    statusCode,
    message,
    stack,
    timestamp: new Date().toISOString()
  });
}; 