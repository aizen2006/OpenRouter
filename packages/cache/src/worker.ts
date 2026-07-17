import { Worker } from 'bullmq';
import { bullConnection } from "./connection";
import { sendEmail } from "./email"

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
        connection: bullConnection,
        concurrency:50,
    },
);
