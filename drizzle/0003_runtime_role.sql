DO $block$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_catalog.pg_roles
		WHERE rolname = 'shadscan_runtime'
	) THEN
		CREATE ROLE "shadscan_runtime"
			NOLOGIN
			NOSUPERUSER
			NOCREATEDB
			NOCREATEROLE
			NOREPLICATION
			NOBYPASSRLS
			INHERIT;
	END IF;
END;
$block$;
--> statement-breakpoint
REVOKE CREATE, USAGE ON SCHEMA public FROM PUBLIC;
--> statement-breakpoint
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM "shadscan_runtime";
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM "shadscan_runtime";
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM "shadscan_runtime";
--> statement-breakpoint
ALTER FUNCTION public."consume_shadscan_rate_limits"(jsonb) SECURITY DEFINER;
--> statement-breakpoint
ALTER FUNCTION public."consume_shadscan_rate_limits"(jsonb)
	SET search_path = pg_catalog, public, pg_temp;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO "shadscan_runtime";
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public."consume_shadscan_rate_limits"(jsonb) TO "shadscan_runtime";
