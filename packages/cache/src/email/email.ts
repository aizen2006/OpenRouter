import { Resend } from 'resend';
import 'dotenv/config';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendEmail(to:string,subject:string,html:string){
    try {
        await resend.emails.send({
            from: "OpenRouter <openrouter@sangoro.com>",
            to: to,
            subject: subject,
            html: html,
        });
    } catch (error) {
        throw new Error('Failed to send the email',{cause:error});
    }
}