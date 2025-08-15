import { useEffect, useState } from 'react';
import { getFingerprintId, hasFingerprintId } from '@/utils/fingerprint';

/**
 * Hook to manage fingerprint ID initialization
 * Automatically checks for existing fingerprint ID on mount and generates one if needed
 */
export const useFingerprint = () => {
  const [fingerprintId, setFingerprintId] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    const initializeFingerprint = async () => {
      try {
        // Check if fingerprint already exists
        const hasExisting = hasFingerprintId();
        
        if (hasExisting) {
                  // Found existing fingerprint ID in localStorage
      } else {
        // No existing fingerprint ID found, generating new one
      }
      
      // Get or generate fingerprint ID
      const id = await getFingerprintId();
      setFingerprintId(id);
      setIsInitialized(true);
      } catch (error) {
        console.error('Error initializing fingerprint ID:', error);
        setIsInitialized(true); // Mark as initialized even on error to prevent infinite loading
      }
    };

    initializeFingerprint();
  }, []);

  return {
    fingerprintId,
    isInitialized,
  };
}; 