import "express";

declare global {
    namespace Express {
        interface Request {
            apiKey?: {
                id: string;
                apiKey:string;
                userId: string;
            };
        }
    }
}