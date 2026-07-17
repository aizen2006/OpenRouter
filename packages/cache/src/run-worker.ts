// Entry point for the email worker process.
// Run with:  bun run worker   (from packages/cache, needs REDIS_URL + RESEND_API_KEY)

// env checks must run BEFORE ./worker is imported — its import chain
// constructs the Resend client, which throws an opaque error on a missing key
if (!process.env.REDIS_URL) {
    console.error("[worker] REDIS_URL is not set — BullMQ would silently dial localhost:6379");
    process.exit(1);
}
if (!process.env.RESEND_API_KEY) {
    console.error("[worker] RESEND_API_KEY is not set — emails cannot be sent");
    process.exit(1);
}

const { signUpEmailworker } = await import("./worker");

signUpEmailworker.on("completed", (job) => {
    console.log(`[worker] email job ${job.id} completed`);
});
signUpEmailworker.on("failed", (job, err) => {
    console.error(`[worker] email job ${job?.id} failed:`, err.message);
});
signUpEmailworker.on("error", (err) => {
    console.error("[worker] worker error:", err);
});

console.log("[worker] email worker started, waiting for jobs on queue 'Emails'");

async function shutdown(signal: string) {
    console.log(`[worker] ${signal} received, draining...`);
    await signUpEmailworker.close();
    process.exit(0);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
