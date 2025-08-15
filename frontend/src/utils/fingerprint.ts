// Fingerprint ID generation and management utilities using FingerprintJS

import FingerprintJS, { Agent } from '@fingerprintjs/fingerprintjs';

const FINGERPRINT_STORAGE_KEY = 'wise_owl_fingerprint_id';

// Initialize FingerprintJS instance
let fpPromise: Promise<Agent> | null = null;

/**
 * Gets or initializes the FingerprintJS instance
 */
const getFingerprintJS = (): Promise<Agent> => {
  if (!fpPromise) {
    fpPromise = FingerprintJS.load();
  }
  return fpPromise;
};

/**
 * Generates a unique fingerprint ID using FingerprintJS
 * This creates a highly accurate and stable identifier for the user's browser/device
 */
export const generateFingerprintId = async (): Promise<string> => {
  try {
    const fp = await getFingerprintJS();
    const result = await fp.get();
    return `fp_${result.visitorId}`;
  } catch (error) {
    console.error('Error generating fingerprint with FingerprintJS:', error);
    // Fallback to a simple timestamp-based ID if FingerprintJS fails
    return `fp_fallback_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
};

/**
 * Gets the fingerprint ID from localStorage or generates a new one
 */
export const getFingerprintId = async (): Promise<string> => {
  try {
    // Check if fingerprint ID exists in localStorage
    const existingFingerprint = localStorage.getItem(FINGERPRINT_STORAGE_KEY);
    
    if (existingFingerprint) {
      return existingFingerprint;
    }
    
    // Generate new fingerprint ID
    const newFingerprint = await generateFingerprintId();
    
    // Store in localStorage
    localStorage.setItem(FINGERPRINT_STORAGE_KEY, newFingerprint);
    
    return newFingerprint;
  } catch (error) {
    console.error('Error managing fingerprint ID:', error);
    // Fallback to generating a temporary ID if localStorage fails
    return await generateFingerprintId();
  }
};

/**
 * Clears the fingerprint ID from localStorage
 * Useful for testing or when user wants to reset their identity
 */
export const clearFingerprintId = (): void => {
  try {
    localStorage.removeItem(FINGERPRINT_STORAGE_KEY);
  } catch (error) {
    console.error('Error clearing fingerprint ID:', error);
  }
};

/**
 * Checks if a fingerprint ID exists in localStorage
 */
export const hasFingerprintId = (): boolean => {
  try {
    return localStorage.getItem(FINGERPRINT_STORAGE_KEY) !== null;
  } catch (error) {
    console.error('Error checking fingerprint ID:', error);
    return false;
  }
}; 