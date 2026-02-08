const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002';

interface FetchOptions extends RequestInit {
  params?: Record<string, string>;
}

export async function api<T>(endpoint: string, options: FetchOptions = {}): Promise<T> {
  const { params, ...fetchOptions } = options;
  
  let url = `${API_BASE}${endpoint}`;
  if (params) {
    const searchParams = new URLSearchParams(params);
    url += `?${searchParams.toString()}`;
  }

  const res = await fetch(url, {
    ...fetchOptions,
    headers: {
      'Content-Type': 'application/json',
      ...fetchOptions.headers,
    },
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: 'Unknown error' }));
    throw new Error(error.message || `API error: ${res.status}`);
  }

  return res.json();
}

export const apiClient = {
  // Organizations
  getOrgs: () => api<{ data: unknown[] }>('/admin/orgs'),
  createOrg: (data: unknown) => api('/admin/orgs', { method: 'POST', body: JSON.stringify(data) }),
  deleteOrg: (id: string) => api(`/admin/orgs/${id}`, { method: 'DELETE' }),

  // Projects
  getProjects: () => api<{ data: unknown[] }>('/admin/projects'),
  createProject: (data: unknown) => api('/admin/projects', { method: 'POST', body: JSON.stringify(data) }),
  deleteProject: (id: string) => api(`/admin/projects/${id}`, { method: 'DELETE' }),

  // API Keys
  getApiKeys: () => api<{ data: unknown[] }>('/admin/api-keys'),
  createApiKey: (data: unknown) => api('/admin/api-keys', { method: 'POST', body: JSON.stringify(data) }),
  revokeApiKey: (id: string) => api(`/admin/api-keys/${id}`, { method: 'DELETE' }),

  // Tasks
  getTasks: (params?: { page?: number; status?: string }) => 
    api<{ data: unknown[]; pagination: { total: number } }>('/v1/tasks', { params: params as Record<string, string> }),
  getTask: (id: string) => api(`/v1/tasks/${id}`),
  cancelTask: (id: string) => api(`/v1/tasks/${id}/cancel`, { method: 'POST' }),
  retryTask: (id: string) => api(`/v1/tasks/${id}/retry`, { method: 'POST' }),

  // Audit
  getAuditLogs: (params?: { page?: number; action?: string }) =>
    api<{ data: unknown[]; pagination: { total: number } }>('/admin/audit', { params: params as Record<string, string> }),

  // Health
  getHealth: () => api<{ status: string; timestamp: string }>('/health'),
};
