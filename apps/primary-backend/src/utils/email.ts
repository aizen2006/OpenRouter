import { Resend } from 'resend';
import 'dotenv/config';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendEmail(to:string,subject:string,html:string){
    await resend.emails.send({
        from: "OpenRouter <info@mydomain.com>",
        to: to,
        subject: subject,
        html: html,
    });
}