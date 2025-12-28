/**
 * SSR (Server-Side Rendering) module for htms components.
 * 
 * This module provides utilities for rendering htms components on the server
 * and generating static HTML that can be hydrated on the client.
 */

export { renderComponentToString, evaluateDirectivesForSSR } from './renderer';
export type { SSRRenderOptions, SSRRenderResult } from './renderer';
export { compileComponentsWithSSR } from './compiler';
