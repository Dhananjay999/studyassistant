// Client-configurable limits (override via Vite env vars).

export const MAX_UPLOAD_FILES =
  Number(import.meta.env.VITE_MAX_UPLOAD_FILES) || 10;

export const MAX_SELECTED_FILES =
  Number(import.meta.env.VITE_MAX_SELECTED_FILES) || 5;
