import { type Request,type Response , type NextFunction } from "express";
import { verifyToken } from "../utils/token";
import { db, usersTable } from "@repo/db";
import { eq } from "drizzle-orm";

export async function auth(req:Request,res:Response,next:NextFunction){
    try {
        const token = req.cookies.token;
        if (!token) {
            return res.status(401).json({
                message: "Authentication required",
            });
        }
        const { id  } = verifyToken(token);
        const [user] = await db.select().from(usersTable).where(eq(usersTable.id,id));
        if(!user){
            return res.status(401).json({
                message:"Authentication required"
            })
        }
        if(!user.emailVerified){
            return res.status(403).json({
                message:"Email verification required"
            })
        }
        req.user = {
            id: user.id,
            email: user.email,
        };
        return next();
    } catch (error) {
        console.error(error);

        return res.status(401).json({
            message: "Invalid or expired token",
        });
    }
}