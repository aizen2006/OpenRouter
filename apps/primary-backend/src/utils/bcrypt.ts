import bcrypt from "bcrypt";

// must be a number — bcrypt treats a string second argument as a literal
// salt ("Invalid salt" error), not a round count
const SALT_ROUNDS = Number(process.env.SALT_ROUNDS) || 12;

export async function hash(password: string): Promise<string> {
    return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verify(
    password: string,
    hashedPassword: string
): Promise<boolean> {
    return bcrypt.compare(password, hashedPassword);
}
