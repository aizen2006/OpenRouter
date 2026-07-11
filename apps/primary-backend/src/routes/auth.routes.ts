import { Router, type Request, type Response } from "express"; 
import { eq }  from "drizzle-orm";
import { db ,usersTable } from "@repo/db";
import { createToken } from "../utils/token";
import { hashPassword, verifyPassword } from "../utils/password";

const app = Router();

// TODO : Add messing service using job queue

app.post('/sign-up',async(req:Request,res:Response)=>{
    const { name , email , password } = req.body;
    // Validation 
    if(!name || !email || !password){
        return res.status(400).json({
            message:"Please enter Valid values for the inputs"
        });
    }

    try {
        const [existing] = await db
            .select()
            .from(usersTable)
            .where(eq(usersTable.email, email));

        if (existing) {
            // Conflict
            return res.status(409).json({
                message: "Email already exists",
            });
        }
        const hash = await hashPassword(password);
        await db.insert(usersTable).values({name:name,email:email,password:hash});
    
        return res.status(201).json({
            message:"User created successfully"
        })
    } catch (error) {
        console.error(error);

        return res.status(500).json({
            message: "Internal Server Error",
        });
    }
});

app.post('/sign-in',async(req:Request,res:Response)=>{
    const { email , password } = req.body;
    // Validation
    if(!email || !password){
        return res.status(400).json({
            message:"Please enter valid credentials",
        })
    } ;
    try {
        // authentication 
        const [user] = await db.select().from(usersTable).where(eq(usersTable.email,email));
        if(!user) return res.status(401).json({
            message:"Please enter valid credentials"
        })
        const isPasswordValid = await verifyPassword(password,user.password);
        if(!isPasswordValid) return res.status(401).json({
            message:"Please enter valid credentials"
        });
    
        if(!user.emailVerified){
            // forbidden
            return res.status(403).json({
                message:"Please verify your email before sign-in"
            })
        }
        // generate jwt token
        const token = createToken(user.id);
    
        res.cookie("token",token,{
            httpOnly:true,
            maxAge: 10 * 60 * 60 * 1000, // 10 hours
            secure: process.env.NODE_ENV === "production",
            sameSite: "strict"
        });
    
        return res.status(200).json({
            message: " User signed in successfully"
        })
    } catch (error) {
        console.error(error);

        return res.status(500).json({
            message: "Internal Server Error",
        });
    }

});

// add email service using job queue
app.post('/forgot-password',async(req:Request,res:Response)=>{

});

app.post('/reset-password')