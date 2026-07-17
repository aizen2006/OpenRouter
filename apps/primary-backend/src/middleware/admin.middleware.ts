import type { NextFunction, Request, Response } from "express";

// Gate on an env allowlist (comma-separated emails) — avoids a schema
// migration for an is_admin flag. Must run AFTER the auth middleware.
export function adminOnly(req: Request, res: Response, next: NextFunction) {
    const admins = (process.env.ADMIN_EMAILS ?? "")
        .split(",")
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean);

    if (!req.user || !admins.includes(req.user.email.toLowerCase())) {
        return res.status(403).json({ message: "Forbidden" });
    }
    return next();
}
