import jwt from "jsonwebtoken"
import 'dotenv/config';

const secret = process.env.JWT_SECRET ?? "Please Add the jwt secret"

// Create jwt token

export function createToken(id:string):string{
    if(!id){
        throw new Error("Please enter a valid email")
    }
    try {
        const token = jwt.sign(
            { id },
            secret!,
            {
                expiresIn: "10h"
            }
        );
        return token;
    } catch (error) {
        throw new Error("Error while generating the token")
    }

}

// Return the Email's

export function verifyToken(token:string):string{
    if(!token){
        throw new Error("Please enter a valid email")
    }
    try {
        const result = jwt.verify(token,secret!) as string;
        return result
    } catch (error) {
        throw new Error("Error while verifing the token")
    }
}