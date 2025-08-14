import { API_ENDPOINTS, API_HEADERS, API_CONFIG, SEARCH_MODES } from '@/constants/api';
import { APIRequest, APIResponse } from '@/types';

class ApiService {
  private baseUrl: string;
  private headers: Record<string, string>;

  constructor() {
    this.baseUrl = API_CONFIG.BASE_URL;
    this.headers = API_HEADERS;
  }

  private async makeRequest<T>(endpoint: string, options: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    
    try {
      // For FormData, don't set Content-Type header (browser sets it automatically)
      const headers = options.body instanceof FormData 
        ? { 'accept': 'application/json' }
        : { ...this.headers, ...options.headers };

      const response = await fetch(url, {
        ...options,
        headers,
      });

      if (!response.ok) {
        let errorMessage = `API request failed with status ${response.status}`;
        
        try {
          const errorData = await response.json();
          console.error('API Error Response:', errorData);
          errorMessage = `API request failed: ${JSON.stringify(errorData)}`;
        } catch (parseError) {
          console.error('Could not parse error response');
        }
        
        throw new Error(errorMessage);
      }

      // For upload endpoint, return void instead of trying to parse JSON
      if (endpoint === API_ENDPOINTS.UPLOAD) {
        return undefined as T;
      }

      return await response.json();
    } catch (error) {
      console.error('API request failed:', error);
      throw error;
    }
  }

  async sendChatMessage(message: string, searchMode: string): Promise<APIResponse> {
    const requestBody: APIRequest = {
      message,
      n_results: API_CONFIG.DEFAULT_RESULTS,
      search_mode: searchMode as 'study_material' | 'web_search'
    };

    return this.makeRequest<APIResponse>(API_ENDPOINTS.CHAT, {
      method: 'POST',
      body: JSON.stringify(requestBody),
    });
  }

  async uploadFiles(files: File[]): Promise<void> {
    const formData = new FormData();
    
    files.forEach((file) => {
      formData.append('files', file);
      console.log('Appending file:', file.name, file.type, file.size);
    });

    // Debug: Log FormData contents
    for (const [key, value] of formData.entries()) {
      console.log('FormData entry:', key, value);
    }

    return this.makeRequest<void>(API_ENDPOINTS.UPLOAD, {
      method: 'POST',
      headers: {
        'accept': 'application/json',
      },
      body: formData,
    });
  }
}

// Export singleton instance
export const apiService = new ApiService(); 