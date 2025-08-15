// API Endpoints
export const API_ENDPOINTS = {
  CHAT: '/chat/',
  UPLOAD: '/upload/',
  GET_FILES: '/upload/files/',
  DELETE_FILE: '/upload/files',
  DELETE_ALL_FILES: '/upload/files/all'
} as const;

// API Headers
export const API_HEADERS = {
  'accept': 'application/json',
  'Content-Type': 'application/json'
} as const;

// API Configuration
export const API_CONFIG = {
  BASE_URL: import.meta.env.VITE_API_BASE_URL || 'https://studyassistant-production.up.railway.app',
  DEFAULT_RESULTS: Number(import.meta.env.VITE_API_DEFAULT_RESULTS) || 5,
  TIMEOUT: Number(import.meta.env.VITE_API_TIMEOUT) || 30000
} as const;

// Search Modes
export const SEARCH_MODES = {
  STUDY_MATERIAL: 'study_material',
  WEB_SEARCH: 'web_search'
} as const; 