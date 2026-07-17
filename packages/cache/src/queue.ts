import { Queue ,type Job } from 'bullmq';
import { bullConnection } from './connection';


const myQueue = new Queue('Emails', { connection: bullConnection });

export async function sendEmailJob(userId:string,to:string , subject:string,html:string){
    let job:Job;
    try {
        job = await myQueue.add(`email-${userId}`,{
            userId,to,subject,html
        },{
            attempts:3,
            backoff: {
                type: "exponential",
                delay: 1000,
            },
            removeOnComplete: 100,
            removeOnFail: 1000
        })
    } catch (error) {
        throw new Error('Failed to Create job for the email')
    }
}

