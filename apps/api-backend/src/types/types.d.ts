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
export interface Message {
    role: "system" | "user" | "assistant" | "tool";
    content: string;
};
export interface Options {
    temperature?: number
    top_p?: number
    max_tokens?: number
    stream?: boolean
}