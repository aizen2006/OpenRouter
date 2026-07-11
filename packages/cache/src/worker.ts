import { Worker, createNodeRedisClient } from 'bullmq';
import { redis } from "./redis"
import { sendEmail } from "./email/email"
const connection = createNodeRedisClient(redis);

export const signUpEmailworker = new Worker(
    'Email',
    async job => {
        const { to , subject , html } = job.data;
        try {
            await sendEmail(to,subject,html);
            
        } catch (error) {
            
        }
    },
    { 
        connection ,
        concurrency:50,
    },
);