import { Worker, createNodeRedisClient } from 'bullmq';
import { redis } from "./redis"
import { sendEmail } from "./email/email"
const connection = createNodeRedisClient(redis);

export const signUpEmailworker = new Worker(
    'Emails',
    async job => {
        const { to , subject , html } = job.data;
        try {
            await sendEmail(to,subject,html);
            
        } catch (error) {
            throw new Error("Error while Processing the email job",{cause:error});
        }
    },
    { 
        connection ,
        concurrency:50,
    },
);