import { runQuote } from './run-quote'
import { prepareDraft } from './prepare-draft'

/**
 * Single registry of Inngest functions served at /api/inngest.
 */
export const functions = [runQuote, prepareDraft]
