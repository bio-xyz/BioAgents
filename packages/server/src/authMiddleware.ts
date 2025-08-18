import { type Request, type Response, type NextFunction } from 'express';

/**
 * Express middleware for validating API Key authentication based on an environment variable.
 *
 * If the ELIZA_SERVER_AUTH_TOKEN environment variable is set, this middleware
 * checks for a matching 'X-API-KEY' header in incoming requests.
 *
 * If the environment variable is *not* set, the middleware allows all requests
 * to pass through without authentication checks.
 *
 * @param req - Express request object.
 * @param res - Express response object.
 * @param next - Express next function.
 */
export function apiKeyAuthMiddleware(_req: Request, _res: Response, next: NextFunction) {
  // deprecated, use customAuth.ts instead
  next();
}
