import { API_ENDPOINTS, API_HEADERS, API_CONFIG, SEARCH_MODES } from '@/constants/api';
import { APIRequest, APIResponse, AuthResponse, RegisterRequest, LoginRequest } from '@/types';
import { getFingerprintId } from '@/utils/fingerprint';

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
      // Get fingerprint ID for user identification
      const fingerprintId = await getFingerprintId();
      
      // Get JWT token from localStorage
      const token = localStorage.getItem('access_token');
      
      // For FormData, don't set Content-Type header (browser sets it automatically)
      const baseHeaders = options.body instanceof FormData 
        ? { 'accept': 'application/json' }
        : { ...this.headers, ...options.headers };
      
      // Add fingerprint ID and JWT token to all requests
      const headers = {
        ...baseHeaders,
        'X-Fingerprint-ID': fingerprintId,
        'user-id': fingerprintId,
        ...(token && { 'Authorization': `Bearer ${token}` }),
      };

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

  async getUploadedFiles(): Promise<{ user_id: string; file_names: string[]; total_files: number }> {
    const fingerprintId = await getFingerprintId();
    return this.makeRequest<{ user_id: string; file_names: string[]; total_files: number }>(
      `${API_ENDPOINTS.GET_FILES}${fingerprintId}`,
      {
        method: 'GET',
      }
    );
  }

  async deleteFile(fileName: string): Promise<{ user_id: string; file_name: string; chunks_deleted: number; message: string }> {
    const fingerprintId = await getFingerprintId();
    const encodedFileName = encodeURIComponent(fileName);
    return this.makeRequest<{ user_id: string; file_name: string; chunks_deleted: number; message: string }>(
      `${API_ENDPOINTS.DELETE_FILE}?file_name=${encodedFileName}`,
      {
        method: 'DELETE',
      }
    );
  }

  async deleteAllFiles(): Promise<{ user_id: string; chunks_deleted: number; message: string }> {
    const fingerprintId = await getFingerprintId();
    return this.makeRequest<{ user_id: string; chunks_deleted: number; message: string }>(
      API_ENDPOINTS.DELETE_ALL_FILES,
      {
        method: 'DELETE',
      }
    );
  }

  // Authentication methods
  async register(userData: RegisterRequest): Promise<AuthResponse> {
    return this.makeRequest<AuthResponse>(API_ENDPOINTS.REGISTER, {
      method: 'POST',
      body: JSON.stringify(userData),
    });
  }

  async login(credentials: LoginRequest): Promise<AuthResponse> {
    return this.makeRequest<AuthResponse>(API_ENDPOINTS.LOGIN, {
      method: 'POST',
      body: JSON.stringify(credentials),
    });
  }
}

// Export singleton instance
export const apiService = new ApiService(); 