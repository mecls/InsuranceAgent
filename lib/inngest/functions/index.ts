import { runUnderwriting } from './run-underwriting'

/**
 * Single registry of Inngest functions served at /api/inngest. Append new
 * functions here as milestones land.
 */
export const functions = [runUnderwriting]
