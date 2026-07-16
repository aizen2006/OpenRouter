import jwt from "jsonwebtoken";
import crypto from 'crypto';
import 'dotenv/config';

const secret = process.env.JWT_SECRET ?? "Please Add the jwt secret"

export interface JwtPayload {
    id: string;
    email: string;
}

// Create jwt token

export function createToken(id:string,email:string):string{
    if(!id || !email){
        throw new Error("Please enter a valid input")
    }
    try {
        const token = jwt.sign(
            { id ,email},
            secret!,
            {
                expiresIn: "10h"
            }
        );
        return token;
    } catch (error) {
        throw new Error("Error while generating the token",{cause:error})
    }

}

// Returns  { userid , email}

export function verifyToken(token:string):JwtPayload {
    if(!token){
        throw new Error("Please enter a valid token")
    }
    try {
        const result = jwt.verify(token,secret!) as JwtPayload ;
        return result
    } catch (error) {
        throw new Error("Error while verifing the token",{cause:error})
    }
}

export const hashToken = (token:string) => {
    return crypto
        .createHash("sha256")
        .update(token)
        .digest("hex");
}