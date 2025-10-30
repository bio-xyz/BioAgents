/**
 * React compatibility shim
 * Re-exports Preact's React compatibility layer so that the Coinbase CDP SDK
 * can use React hooks with Preact.
 */

// Export everything from preact/compat as if it were React
export * from 'preact/compat';
export { default } from 'preact/compat';
