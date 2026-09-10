export type AppConfig = {
  apiBaseUrl: string;
  deviceSecret: string;
  mockApi: boolean;
  pollMs: number;
};

function env(name: string): string {
  const value = import.meta.env[name];
  return typeof value === 'string' ? value.trim() : '';
}

export function loadAppConfig(): AppConfig {
  const mockApi = env('VITE_MOCK_API') === 'true';
  return {
    apiBaseUrl: env('VITE_API_BASE_URL').replace(/\/$/, ''),
    deviceSecret: env('VITE_DEVICE_SECRET'),
    mockApi,
    pollMs: 1500,
  };
}
