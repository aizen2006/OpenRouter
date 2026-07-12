import { Router, type Request, type Response } from "express"; 
import { eq }  from "drizzle-orm";
import { db ,usersTable } from "@repo/db";
import { createToken , hashToken } from "../utils/token";
import { hash, verify  } from "../utils/bcrypt";
import { sendEmailJob , redis } from "@repo/redis";
import { verifyEmailTemplate , forgotPasswordTemplate} from "../utils/emailTemplate";
import crypto from 'crypto';
import { limiter } from "../middleware/ratelimit.middleware";


const app = Router();

app.post('/sign-up',limiter,async(req:Request,res:Response)=>{
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
        const hash_password = await hash(password);

        const [user] = await db
        .insert(usersTable)
        .values({name:name,email:email,password:hash_password})
        .returning();

        if(!user) return res.status(500).json({
            message: "Failed to add the user",
        });

        const subject : string = ' Verify your Email ';
        
        const token = crypto.randomBytes(32).toString('base64url');

        const tokenHash = hashToken(token);

        // store the token in redis for later verification with ttl of 15 mins
        await redis.setEx(`verify:${tokenHash}`,15*60,user.id);
        
        const verifyUrl: string = `https://openrouter.soubhikhalder.com/verify-email?token=${token}`

        const html = verifyEmailTemplate({ name ,verifyUrl});
        
        await sendEmailJob(user.id,email,subject,html);

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

app.post('/sign-in',limiter,async(req:Request,res:Response)=>{
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
        const isPasswordValid = await verify(password,user.password);
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
        const token = createToken(user.id,user.email);
    
        res.cookie("token",token,{
            httpOnly:true,
            maxAge: 10 * 60 * 60 * 1000, // 10 hours
            secure: process.env.NODE_ENV === "production",
            path:"/",
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


app.post('/forgot-password',limiter,async(req:Request,res:Response)=>{
    // Validation
    const { email } = req.body;
    if( !email ) return res.status(400).json({message:"Please send a Valid Email"});
    try {
        const [user] = await db.select().from(usersTable).where(eq(usersTable.email,email));
        if (!user) {
            return res.status(404).json({
                message: "If an account exists, we've sent a password reset email.",
            });
        }
        const subject : string = ' Reset your password ';
        
        const token = crypto.randomBytes(32).toString('base64url');

        const tokenHash = hashToken(token)

        // store the token in redis for later verification with ttl of 15 mins
        await redis.setEx(`reset_password:${tokenHash}`,15*60,user.id);
        
        const resetUrl: string = `https://openrouter.soubhikhalder.com/reset-password?token=${token}`

        const html = forgotPasswordTemplate({ name:user.name,resetUrl});
        
        await sendEmailJob(user.id,email,subject,html);

        return res.status(200).json({
            message: "Password reset email sent."
        })

    } catch (error) {
        console.error(error);

        return res.status(500).json({
            message: "Internal Server Error",
        });
    }
});

app.post('/reset-password',limiter,async(req:Request,res:Response)=>{
    const token : string  = req.query.token as string ;
    const password : string = req.body.password as string;

    if(!token || !password ) return res.status(400).json({message:"Message a vaild token or password"});

    const tokenHash = hashToken(token);

    try {
        const userId = await redis.get(`reset_password:${tokenHash}`);

        if(!userId ) return res.status(400).json({
            message:"Token is expired or invalid token"
        });
        const passwordHash : string = await hash(password);
        const [user] = await db
        .update(usersTable)
        .set({password:passwordHash})
        .where(eq(usersTable.id,userId))
        .returning({id: usersTable.id});
        

        if (!user) {
            return res.status(200).json({
                message: "If an account exists, we've sent a password reset email.",
            });
        }

        await redis.del(`reset_password:${tokenHash}`);

        return res.status(200).json({
            message:'Successfully reset the password of the User'
        })
    } catch (error) {
        console.error(error);

        return res.status(500).json({
            message: "Failed to reset the password of the user",
        });
    }
});

app.post('/verify-email',async(req:Request,res:Response)=>{
    const token : string  = req.query.token as string ;

    if(!token) return res.status(400).json({message:"Message a vaild token"});

    const tokenHash = hashToken(token);

    try {
        const userId = await redis.get(`verify:${tokenHash}`);

        if(!userId ) return res.status(400).json({
            message:"Token is expired or invalid token"
        });

        const result = await db
        .update(usersTable)
        .set({emailVerified:true})
        .where(eq(usersTable.id,userId))
        .returning({id: usersTable.id});
        

        if (result.length === 0) {
            return res.status(404).json({
                message: "User not found",
            });
        }

        await redis.del(`verify:${tokenHash}`);

        return res.status(200).json({
            message:'Successfully verified the Email'
        })
    } catch (error) {
        console.error(error);

        return res.status(500).json({
            message: "Failed to verify email",
        });
    }

});

app.post("/logout", (req: Request, res: Response) => {
    res.clearCookie("token", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        path: "/"
    });

    return res.status(200).json({
        message: "Logged out successfully",
    });
});

export { app };