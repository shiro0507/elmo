#!/usr/bin/env tsx
/**
 * Manually create a local-mode user + their own organization, bypassing the
 * Better Auth signup flow entirely.
 *
 * Local mode's `user.create.before` hook (apps/web/src/lib/auth/server.ts)
 * rejects any signup once one user exists, regardless of entry point (UI,
 * curl, or auth.api.createUser) — so this script never touches Better
 * Auth's API. It hashes the password with Better Auth's own scheme
 * (@workspace/lib's hashUserPassword, a scrypt-based re-export of
 * better-auth/crypto's hashPassword) and inserts the
 * `user` + `account` rows directly, then reuses provisionAdditionalLocalOrg
 * (the same function the "create new brand" flow calls) to create a fresh
 * organization + admin membership for this user.
 *
 * The new user lands in their own org with zero brands, so on first login
 * they hit the brand-onboarding wizard — no access to any other org's data,
 * since every brand/org query in this app filters through the `member`
 * table (no hardcoded org id anywhere outside provisioning.ts).
 *
 * Usage (must run with cwd = apps/web so tsx picks up its tsconfig paths):
 *   cd apps/web
 *   DATABASE_URL="postgresql://..." pnpm tsx scripts/create-user.ts \
 *     --email=dd-gs-sol1@example.com --name=dd-gs-sol1 --password=dd-gs-sol1 --org-name="dd-gs-sol1"
 */
import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@workspace/lib/db/db";
import { user, account } from "@workspace/lib/db/schema-auth";
import { provisionAdditionalLocalOrg } from "@workspace/lib/db/provisioning";
import { hashUserPassword } from "@workspace/lib/auth/server";

const { values } = parseArgs({
	options: {
		email: { type: "string" },
		name: { type: "string" },
		password: { type: "string" },
		"org-name": { type: "string" },
	},
});

if (!values.email || !values.name || !values.password || !values["org-name"]) {
	console.error(
		"Usage: pnpm tsx scripts/create-user.ts --email=<email> --name=<name> --password=<password> --org-name=<orgName>",
	);
	process.exit(1);
}
if (!process.env.DATABASE_URL) {
	console.error("DATABASE_URL is required.");
	process.exit(1);
}

const email = values.email;
const name = values.name;
const password = values.password;
const orgName = values["org-name"];

async function main() {
	const [existing] = await db.select({ id: user.id }).from(user).where(eq(user.email, email)).limit(1);
	if (existing) {
		console.error(`A user with email "${email}" already exists (id=${existing.id}).`);
		process.exit(1);
	}

	const passwordHash = await hashUserPassword(password);
	const userId = randomUUID();
	const now = new Date();

	await db.insert(user).values({
		id: userId,
		name,
		email,
		emailVerified: true,
		createdAt: now,
		updatedAt: now,
	});

	await db.insert(account).values({
		id: randomUUID(),
		accountId: userId,
		providerId: "credential",
		userId,
		password: passwordHash,
		createdAt: now,
		updatedAt: now,
	});

	const { orgId } = await provisionAdditionalLocalOrg({ userId, name: orgName });

	console.log(`Created user "${name}" <${email}> (id=${userId}) in new organization "${orgId}".`);
	console.log("They can log in at /auth/login and will land on the brand-onboarding wizard.");
}

main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.error(error);
		process.exit(1);
	});
