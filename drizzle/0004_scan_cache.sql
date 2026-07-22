CREATE TABLE "scan_cache" (
	"cache_key" text PRIMARY KEY NOT NULL,
	"category" text NOT NULL,
	"commit_sha" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"engine_version" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"payload" jsonb NOT NULL,
	"project_path" text NOT NULL,
	"repository_hash" text NOT NULL,
	"ruleset_version" text NOT NULL,
	CONSTRAINT "scan_cache_cache_key_check" CHECK (char_length("scan_cache"."cache_key") = 64),
	CONSTRAINT "scan_cache_repository_hash_check" CHECK (char_length("scan_cache"."repository_hash") = 64),
	CONSTRAINT "scan_cache_commit_sha_check" CHECK (char_length("scan_cache"."commit_sha") = 40),
	CONSTRAINT "scan_cache_project_path_check" CHECK (char_length("scan_cache"."project_path") between 1 and 512)
);
--> statement-breakpoint
CREATE INDEX "scan_cache_expires_at_idx" ON "scan_cache" USING btree ("expires_at");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public."get_shadscan_scan_cache"("input_cache_key" text)
RETURNS TABLE ("payload" jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
BEGIN
	IF "input_cache_key" !~ '^[a-f0-9]{64}$' THEN
		RAISE EXCEPTION 'The scan-cache key is invalid.' USING ERRCODE = '22023';
	END IF;

	RETURN QUERY
	SELECT cache.payload
	FROM public.scan_cache AS cache
	WHERE cache.cache_key = "input_cache_key"
		AND cache.expires_at > clock_timestamp();

	DELETE FROM public.scan_cache AS expired
	WHERE expired.ctid IN (
		SELECT candidate.ctid
		FROM public.scan_cache AS candidate
		WHERE candidate.expires_at <= clock_timestamp()
		ORDER BY candidate.expires_at
		LIMIT 100
	);
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public."put_shadscan_scan_cache"(
	"input_cache_key" text,
	"input_repository_hash" text,
	"input_commit_sha" text,
	"input_project_path" text,
	"input_category" text,
	"input_engine_version" text,
	"input_ruleset_version" text,
	"input_payload" jsonb,
	"input_ttl_seconds" integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
	"now_at" timestamp with time zone := clock_timestamp();
BEGIN
	IF
		"input_cache_key" !~ '^[a-f0-9]{64}$'
		OR "input_repository_hash" !~ '^[a-f0-9]{64}$'
		OR "input_commit_sha" !~ '^[a-f0-9]{40}$'
		OR char_length("input_project_path") NOT BETWEEN 1 AND 512
		OR char_length("input_category") NOT BETWEEN 1 AND 64
		OR char_length("input_engine_version") NOT BETWEEN 1 AND 128
		OR char_length("input_ruleset_version") NOT BETWEEN 1 AND 128
		OR jsonb_typeof("input_payload") <> 'object'
		OR octet_length("input_payload"::text) > 2000000
		OR "input_ttl_seconds" NOT BETWEEN 60 AND 2592000
	THEN
		RAISE EXCEPTION 'The scan-cache entry is invalid.' USING ERRCODE = '22023';
	END IF;

	INSERT INTO public.scan_cache AS cache (
		cache_key,
		category,
		commit_sha,
		created_at,
		engine_version,
		expires_at,
		payload,
		project_path,
		repository_hash,
		ruleset_version
	)
	VALUES (
		"input_cache_key",
		"input_category",
		"input_commit_sha",
		"now_at",
		"input_engine_version",
		"now_at" + make_interval(secs => "input_ttl_seconds"),
		"input_payload",
		"input_project_path",
		"input_repository_hash",
		"input_ruleset_version"
	)
	ON CONFLICT (cache_key)
	DO UPDATE SET
		category = excluded.category,
		commit_sha = excluded.commit_sha,
		created_at = excluded.created_at,
		engine_version = excluded.engine_version,
		expires_at = excluded.expires_at,
		payload = excluded.payload,
		project_path = excluded.project_path,
		repository_hash = excluded.repository_hash,
		ruleset_version = excluded.ruleset_version;
END;
$function$;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE public.scan_cache FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE public.scan_cache FROM "shadscan_runtime";
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public."get_shadscan_scan_cache"(text) FROM PUBLIC;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public."put_shadscan_scan_cache"(text, text, text, text, text, text, text, jsonb, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public."get_shadscan_scan_cache"(text) TO "shadscan_runtime";
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public."put_shadscan_scan_cache"(text, text, text, text, text, text, text, jsonb, integer) TO "shadscan_runtime";
