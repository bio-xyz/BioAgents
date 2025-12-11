/**
 * Authentication Middleware - Backward Compatibility Layer
 *
 * This module re-exports from the new authResolver middleware for backward compatibility.
 * New code should import directly from './authResolver' instead.
 *
 * @deprecated Use authResolver from './authResolver' instead
 */

// Re-export the new authResolver as authBeforeHandle for backward compatibility
export { authBeforeHandle, authResolver } from "./authResolver";
export type { AuthResolverOptions as AuthOptions } from "../types/auth";
