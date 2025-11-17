// src/services/api/ExternalApi.ts

import axios, {AxiosInstance, InternalAxiosRequestConfig} from 'axios';
import {RequestContext} from '@orders/utils/request-context';
import {config} from '@orders/config';

class ExternalApi {
    private static instance: ExternalApi;
    private readonly api: AxiosInstance;

    // Private constructor để áp dụng Singleton Pattern
    private constructor() {
        this.api = axios.create({
            baseURL: `${config.API_GATEWAY_URL}`, // Đặt BASE_URL của server bạn muốn gọi
            timeout: 10000,
        });

        this.setupInterceptors();
    }

    // Hàm tĩnh để lấy instance duy nhất của class
    public static getInstance(): ExternalApi {
        if (!ExternalApi.instance) {
            ExternalApi.instance = new ExternalApi();
        }
        return ExternalApi.instance;
    }

    // Thiết lập Interceptor
    private setupInterceptors(): void {
        this.api.interceptors.request.use(
            this.requestInterceptor,
            (error: Error) => Promise.reject(new Error(error?.message || 'Request failed'))
        );
    }

    // Logic xử lý request: Lấy Token từ Context và gắn vào Header
    private requestInterceptor = (config: InternalAxiosRequestConfig): InternalAxiosRequestConfig => {
        // Lấy token từ RequestContext (Thread-Local Storage)
        const token = RequestContext.getToken();

        if (token) {
            config.headers['X-Internal-Token'] = `${token}`;
        }

        return config;
    };

    // Getter để truy cập Axios Instance đã cấu hình
    public getApiInstance(): AxiosInstance {
        return this.api;
    }
}

// Export instance đã cấu hình
export const externalApiInstance = ExternalApi.getInstance().getApiInstance();