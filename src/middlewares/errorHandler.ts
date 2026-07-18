/**
 * Global Express error handling — the HTTP layer must never crash the app.
 */
import { NextFunction, Request, Response } from 'express';
import { moduleLogger } from '../utils/logger';

const log = moduleLogger('HTTP');

/** 404 handler for unknown routes. */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ error: 'Not found' });
}

/** Catch-all error handler. */
export function errorHandler(
  error: Error,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  next: NextFunction
): void {
  log.error(`Unhandled HTTP error on ${req.method} ${req.path}: ${error.message}`);
  if (!res.headersSent) {
    res.status(500).json({ error: 'Internal server error' });
  }
}
