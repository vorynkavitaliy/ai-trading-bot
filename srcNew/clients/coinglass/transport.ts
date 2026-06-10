import { QueryValue } from '../../core/http';

export interface CgTransport {
  request<T>(path: string, params?: Record<string, QueryValue>): Promise<T>;
}
