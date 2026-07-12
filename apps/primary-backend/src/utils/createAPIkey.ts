import crypto from "crypto";

export default function createApiKey():string{
    const api_suffix = crypto.randomBytes(48).toString('base64url');
    const api_prefix = process.env.API_PREFIX ?? 'sk_';
    const apiKey = api_prefix+api_suffix;
    return apiKey;
}

