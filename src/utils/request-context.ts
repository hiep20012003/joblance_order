// src/context/requestContext.ts
import {AsyncLocalStorage} from 'async_hooks';

// Định nghĩa Interface cho dữ liệu Store
interface RequestContextStore {
    internalToken?: string;
    userId?: string;
    // Thêm các trường dữ liệu ngữ cảnh khác nếu cần
}

// Export instance AsyncLocalStorage
export const context = new AsyncLocalStorage<RequestContextStore>();

// Export Class tiện ích để truy cập Store
export class RequestContext {

    // Hàm tĩnh để lấy toàn bộ Store
    static getStore(): RequestContextStore | undefined {
        return context.getStore();
    }

    // Hàm tĩnh để lấy Internal Token
    static getToken(): string | undefined {
        return this.getStore()?.internalToken;
    }

    // Hàm tĩnh để lấy User ID
    static getUserId(): string | undefined {
        return this.getStore()?.userId;
    }

}