export function verifyEmailTemplate({
    name,
    verifyUrl,
}: {
    name: string,
    verifyUrl: string
    }) 
{
    return `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Verify your email</title>
</head>

<body style="margin:0;padding:0;background:#f5f7fb;font-family:Arial,Helvetica,sans-serif;color:#111827;">

<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:40px 16px;">
<tr>
<td align="center">

<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="background:#ffffff;border-radius:16px;padding:48px 40px;box-shadow:0 8px 30px rgba(0,0,0,0.05);">

<tr>
<td align="center">

<div style="
width:64px;
height:64px;
line-height:64px;
border-radius:50%;
background:#111827;
color:#ffffff;
font-size:28px;
font-weight:bold;
margin-bottom:24px;
">
✓
</div>

<h1 style="
margin:0;
font-size:28px;
font-weight:700;
color:#111827;
">
Verify your email
</h1>

<p style="
margin:24px 0 0;
font-size:16px;
line-height:28px;
color:#4b5563;
">
Hi <strong>${name}</strong>,
</p>

<p style="
margin:16px 0 0;
font-size:16px;
line-height:28px;
color:#4b5563;
">
Thanks for signing up! Please confirm your email address to activate your account.
</p>

<a
href="${verifyUrl}"
style="
display:inline-block;
margin-top:36px;
background:#111827;
color:#ffffff;
padding:14px 32px;
text-decoration:none;
border-radius:10px;
font-size:16px;
font-weight:600;
"
>
Verify Email
</a>

<p style="
margin-top:32px;
font-size:14px;
line-height:24px;
color:#6b7280;
">
Or copy and paste this link into your browser:
</p>

<p style="
word-break:break-word;
font-size:13px;
line-height:22px;
color:#2563eb;
">
${verifyUrl}
</p>

<hr style="
margin:40px 0;
border:none;
border-top:1px solid #e5e7eb;
">

<p style="
margin:0;
font-size:14px;
line-height:24px;
color:#6b7280;
">
If you didn't create this account, you can safely ignore this email.
</p>

<p style="
margin-top:20px;
font-size:13px;
color:#9ca3af;
">
This verification link will expire in <strong>15 minutes</strong>.
</p>

</td>
</tr>

</table>

</td>
</tr>
</table>

</body>
</html>
`;
}


export function forgotPasswordTemplate({
    name,
    resetUrl,
}: {
    name: string;
    resetUrl: string;
}) {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Reset your password</title>
</head>

<body style="margin:0;padding:0;background:#f4f6f9;font-family:Arial,Helvetica,sans-serif;">

<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:40px 16px;">
<tr>
<td align="center">

<table role="presentation" width="600" cellspacing="0" cellpadding="0"
style="
background:#ffffff;
border-radius:16px;
padding:48px 40px;
box-shadow:0 8px 30px rgba(0,0,0,0.05);
">

<tr>
<td align="center">

<div
style="
width:64px;
height:64px;
line-height:64px;
border-radius:50%;
background:#ef4444;
color:white;
font-size:28px;
font-weight:bold;
margin-bottom:24px;
">
</div>

<h1
style="
margin:0;
font-size:28px;
font-weight:700;
color:#111827;
">
Reset Your Password
</h1>

<p
style="
margin-top:24px;
font-size:16px;
line-height:28px;
color:#4b5563;
">
Hi <strong>${name}</strong>,
</p>

<p
style="
margin-top:12px;
font-size:16px;
line-height:28px;
color:#4b5563;
">
We received a request to reset the password for your account.
If you made this request, click the button below to choose a new password.
</p>

<a
href="${resetUrl}"
style="
display:inline-block;
margin-top:32px;
padding:14px 32px;
background:#111827;
color:#ffffff;
text-decoration:none;
font-size:16px;
font-weight:600;
border-radius:10px;
">
Reset Password
</a>

<p
style="
margin-top:36px;
font-size:14px;
line-height:24px;
color:#6b7280;
">
Or copy and paste this link into your browser:
</p>

<p
style="
word-break:break-word;
font-size:13px;
line-height:22px;
color:#2563eb;
">
${resetUrl}
</p>

<hr
style="
margin:40px 0;
border:none;
border-top:1px solid #e5e7eb;
">

<p
style="
margin:0;
font-size:15px;
line-height:26px;
color:#4b5563;
">
This password reset link will expire in <strong>15 minutes</strong>.
</p>

<p
style="
margin-top:20px;
font-size:14px;
line-height:24px;
color:#6b7280;
">
If you didn't request a password reset, you can safely ignore this email.
Your password won't be changed unless you use the link above.
</p>

<p
style="
margin-top:32px;
font-size:13px;
color:#9ca3af;
">
For security reasons, this link can only be used once.
</p>

</td>
</tr>

</table>

</td>
</tr>
</table>

</body>
</html>
`;
}