CREATE TABLE "rate_limit_windows" (
	"bucket" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"identity_hash" text NOT NULL,
	"request_count" integer NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	CONSTRAINT "rate_limit_windows_pkey" PRIMARY KEY("bucket","identity_hash","window_started_at"),
	CONSTRAINT "rate_limit_windows_identity_hash_check" CHECK (char_length("rate_limit_windows"."identity_hash") = 64),
	CONSTRAINT "rate_limit_windows_request_count_check" CHECK ("rate_limit_windows"."request_count" >= 0)
);
--> statement-breakpoint
CREATE INDEX "rate_limit_windows_expires_at_idx" ON "rate_limit_windows" USING btree ("expires_at");