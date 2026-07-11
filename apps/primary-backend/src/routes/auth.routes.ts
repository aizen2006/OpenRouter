import { Router, type Request, type Response } from "express";
import { db } from "@repo/db";

const app = Router();
// flow 
app.post('sign-up',async(req:Request,res:Response)=>{
    const { name , email , password } = req.body;
    if(!name || !email || !password){
        return res.status(400).json({
            message:"Please enter Valid values for the inputs"
        });
    }
    
})