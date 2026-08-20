CREATE TABLE "domain_categories" (
	"domain" text PRIMARY KEY NOT NULL,
	"category" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "domain_categories" ENABLE ROW LEVEL SECURITY;
