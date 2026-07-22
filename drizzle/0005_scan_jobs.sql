CREATE TABLE "scan_jobs" (
	"attempts" integer DEFAULT 0 NOT NULL,
	"cache_key" text NOT NULL,
	"category" text NOT NULL,
	"commit_sha" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"job_id" uuid PRIMARY KEY NOT NULL,
	"lease_expires_at" timestamp with time zone,
	"project_path" text NOT NULL,
	"repository_hash" text NOT NULL,
	"result_cache_key" text,
	"state" text NOT NULL,
	"terminal_error" jsonb,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "scan_jobs_cache_key_check" CHECK (char_length("scan_jobs"."cache_key") = 64),
	CONSTRAINT "scan_jobs_repository_hash_check" CHECK (char_length("scan_jobs"."repository_hash") = 64),
	CONSTRAINT "scan_jobs_commit_sha_check" CHECK (char_length("scan_jobs"."commit_sha") = 40),
	CONSTRAINT "scan_jobs_project_path_check" CHECK (char_length("scan_jobs"."project_path") between 1 and 512),
	CONSTRAINT "scan_jobs_state_check" CHECK ("scan_jobs"."state" in ('queued', 'running', 'completed', 'failed')),
	CONSTRAINT "scan_jobs_attempts_check" CHECK ("scan_jobs"."attempts" >= 0),
	CONSTRAINT "scan_jobs_result_cache_key_check" CHECK ("scan_jobs"."result_cache_key" IS NULL OR char_length("scan_jobs"."result_cache_key") = 64),
	CONSTRAINT "scan_jobs_terminal_error_check" CHECK ("scan_jobs"."terminal_error" IS NULL OR jsonb_typeof("scan_jobs"."terminal_error") = 'object')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "scan_jobs_cache_key_unique" ON "scan_jobs" USING btree ("cache_key");
--> statement-breakpoint
CREATE INDEX "scan_jobs_expires_at_idx" ON "scan_jobs" USING btree ("expires_at");
--> statement-breakpoint
CREATE INDEX "scan_jobs_state_lease_idx" ON "scan_jobs" USING btree ("state", "lease_expires_at");
--> statement-breakpoint
CREATE TABLE "scan_job_access" (
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"job_id" uuid NOT NULL,
	"token_hash" text PRIMARY KEY NOT NULL,
	CONSTRAINT "scan_job_access_token_hash_check" CHECK (char_length("scan_job_access"."token_hash") = 64),
	CONSTRAINT "scan_job_access_job_id_scan_jobs_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."scan_jobs"("job_id") ON DELETE cascade ON UPDATE cascade
);
--> statement-breakpoint
CREATE INDEX "scan_job_access_job_id_idx" ON "scan_job_access" USING btree ("job_id");
--> statement-breakpoint
CREATE INDEX "scan_job_access_expires_at_idx" ON "scan_job_access" USING btree ("expires_at");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public."create_shadscan_scan_job"(
	"input_proposed_job_id" uuid,
	"input_token_hash" text,
	"input_cache_key" text,
	"input_repository_hash" text,
	"input_commit_sha" text,
	"input_project_path" text,
	"input_category" text,
	"input_ttl_seconds" integer
)
RETURNS TABLE ("resolved_job_id" uuid, "resolved_state" text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
	"now_at" timestamp with time zone := clock_timestamp();
	"job_expires_at" timestamp with time zone;
BEGIN
	IF
		"input_proposed_job_id" IS NULL
		OR "input_token_hash" !~ '^[a-f0-9]{64}$'
		OR "input_cache_key" !~ '^[a-f0-9]{64}$'
		OR "input_repository_hash" !~ '^[a-f0-9]{64}$'
		OR "input_commit_sha" !~ '^[a-f0-9]{40}$'
		OR char_length("input_project_path") NOT BETWEEN 1 AND 512
		OR char_length("input_category") NOT BETWEEN 1 AND 64
		OR "input_ttl_seconds" NOT BETWEEN 60 AND 604800
	THEN
		RAISE EXCEPTION 'The scan-job entry is invalid.' USING ERRCODE = '22023';
	END IF;

	"job_expires_at" := "now_at" + make_interval(secs => "input_ttl_seconds");

	DELETE FROM public.scan_job_access AS expired_access
	WHERE expired_access.ctid IN (
		SELECT candidate.ctid
		FROM public.scan_job_access AS candidate
		WHERE candidate.expires_at <= "now_at"
		ORDER BY candidate.expires_at
		LIMIT 100
	);

	DELETE FROM public.scan_jobs AS expired_job
	WHERE expired_job.ctid IN (
		SELECT candidate.ctid
		FROM public.scan_jobs AS candidate
		WHERE candidate.expires_at <= "now_at"
		ORDER BY candidate.expires_at
		LIMIT 100
	);

	INSERT INTO public.scan_jobs AS job (
		attempts,
		cache_key,
		category,
		commit_sha,
		created_at,
		expires_at,
		job_id,
		project_path,
		repository_hash,
		state,
		updated_at
	)
	VALUES (
		0,
		"input_cache_key",
		"input_category",
		"input_commit_sha",
		"now_at",
		"job_expires_at",
		"input_proposed_job_id",
		"input_project_path",
		"input_repository_hash",
		'queued',
		"now_at"
	)
	ON CONFLICT (cache_key)
	DO UPDATE SET
		attempts = CASE
			WHEN job.expires_at <= "now_at" OR job.state = 'failed' OR (
				job.state = 'completed'
				AND NOT EXISTS (
					SELECT 1 FROM public.scan_cache AS cache
					WHERE cache.cache_key = job.cache_key
						AND cache.expires_at > "now_at"
				)
			) THEN 0
			ELSE job.attempts
		END,
		expires_at = CASE
			WHEN job.expires_at <= "now_at" OR job.state = 'failed' OR (
				job.state = 'completed'
				AND NOT EXISTS (
					SELECT 1 FROM public.scan_cache AS cache
					WHERE cache.cache_key = job.cache_key
						AND cache.expires_at > "now_at"
				)
			) THEN "job_expires_at"
			ELSE greatest(job.expires_at, "job_expires_at")
		END,
		lease_expires_at = CASE
			WHEN job.expires_at <= "now_at" OR job.state = 'failed' OR (
				job.state = 'completed'
				AND NOT EXISTS (
					SELECT 1 FROM public.scan_cache AS cache
					WHERE cache.cache_key = job.cache_key
						AND cache.expires_at > "now_at"
				)
			) THEN NULL
			ELSE job.lease_expires_at
		END,
		result_cache_key = CASE
			WHEN job.expires_at <= "now_at" OR job.state = 'failed' OR (
				job.state = 'completed'
				AND NOT EXISTS (
					SELECT 1 FROM public.scan_cache AS cache
					WHERE cache.cache_key = job.cache_key
						AND cache.expires_at > "now_at"
				)
			) THEN NULL
			ELSE job.result_cache_key
		END,
		state = CASE
			WHEN job.expires_at <= "now_at" OR job.state = 'failed' OR (
				job.state = 'completed'
				AND NOT EXISTS (
					SELECT 1 FROM public.scan_cache AS cache
					WHERE cache.cache_key = job.cache_key
						AND cache.expires_at > "now_at"
				)
			) THEN 'queued'
			ELSE job.state
		END,
		terminal_error = CASE
			WHEN job.expires_at <= "now_at" OR job.state = 'failed' OR (
				job.state = 'completed'
				AND NOT EXISTS (
					SELECT 1 FROM public.scan_cache AS cache
					WHERE cache.cache_key = job.cache_key
						AND cache.expires_at > "now_at"
				)
			) THEN NULL
			ELSE job.terminal_error
		END,
		updated_at = "now_at"
	RETURNING
		job.job_id,
		job.state
	INTO "resolved_job_id", "resolved_state";

	INSERT INTO public.scan_job_access (
		created_at,
		expires_at,
		job_id,
		token_hash
	)
	VALUES (
		"now_at",
		"job_expires_at",
		"resolved_job_id",
		"input_token_hash"
	)
	ON CONFLICT (token_hash)
	DO UPDATE SET
		expires_at = excluded.expires_at,
		job_id = excluded.job_id;

	RETURN NEXT;
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public."get_shadscan_scan_job"(
	"input_job_id" uuid,
	"input_token_hash" text
)
RETURNS TABLE ("job_state" text, "payload" jsonb, "terminal_error" jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
	"now_at" timestamp with time zone := clock_timestamp();
BEGIN
	IF "input_job_id" IS NULL OR "input_token_hash" !~ '^[a-f0-9]{64}$' THEN
		RAISE EXCEPTION 'The scan-job credential is invalid.' USING ERRCODE = '22023';
	END IF;

	RETURN QUERY
	SELECT
		CASE
			WHEN job.expires_at <= "now_at" THEN 'failed'
			WHEN cache.payload IS NOT NULL THEN 'completed'
			WHEN job.state = 'completed' THEN 'failed'
			ELSE job.state
		END,
		cache.payload,
		CASE
			WHEN job.expires_at <= "now_at" OR (
				job.state = 'completed' AND cache.payload IS NULL
			) THEN jsonb_build_object(
				'code', 'SCAN_JOB_EXPIRED',
				'message', 'This queued scan expired. Submit it again.',
				'retryable', true
			)
			ELSE job.terminal_error
		END
	FROM public.scan_jobs AS job
	INNER JOIN public.scan_job_access AS access
		ON access.job_id = job.job_id
		AND access.token_hash = "input_token_hash"
	LEFT JOIN public.scan_cache AS cache
		ON cache.cache_key = job.cache_key
		AND cache.expires_at > "now_at"
	WHERE job.job_id = "input_job_id";
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public."claim_shadscan_scan_job"(
	"input_job_id" uuid,
	"input_lease_seconds" integer,
	"input_max_attempts" integer,
	"input_max_concurrency" integer
)
RETURNS TABLE ("claim_action" text, "attempt_count" integer, "resolved_cache_key" text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
	"active_count" integer;
	"job" public.scan_jobs%ROWTYPE;
	"now_at" timestamp with time zone := clock_timestamp();
BEGIN
	IF
		"input_job_id" IS NULL
		OR "input_lease_seconds" NOT BETWEEN 30 AND 3600
		OR "input_max_attempts" NOT BETWEEN 1 AND 10
		OR "input_max_concurrency" NOT BETWEEN 1 AND 10
	THEN
		RAISE EXCEPTION 'The scan-job claim is invalid.' USING ERRCODE = '22023';
	END IF;

	PERFORM pg_advisory_xact_lock(hashtext('shadscan_scan_job_claim'));

	SELECT * INTO "job"
	FROM public.scan_jobs
	WHERE job_id = "input_job_id"
	FOR UPDATE;

	IF NOT FOUND THEN
		RETURN;
	END IF;

	"resolved_cache_key" := "job".cache_key;
	"attempt_count" := "job".attempts;

	IF "job".expires_at <= "now_at" THEN
		UPDATE public.scan_jobs
		SET
			lease_expires_at = NULL,
			state = 'failed',
			terminal_error = jsonb_build_object(
				'code', 'SCAN_JOB_EXPIRED',
				'message', 'This queued scan expired. Submit it again.',
				'retryable', true
			),
			updated_at = "now_at"
		WHERE job_id = "input_job_id";
		"claim_action" := 'terminal';
		RETURN NEXT;
		RETURN;
	END IF;

	IF EXISTS (
		SELECT 1 FROM public.scan_cache AS cache
		WHERE cache.cache_key = "job".cache_key
			AND cache.expires_at > "now_at"
	) THEN
		UPDATE public.scan_jobs
		SET
			lease_expires_at = NULL,
			result_cache_key = "job".cache_key,
			state = 'completed',
			terminal_error = NULL,
			updated_at = "now_at"
		WHERE job_id = "input_job_id";
		"claim_action" := 'completed';
		RETURN NEXT;
		RETURN;
	END IF;

	IF "job".state = 'failed' THEN
		"claim_action" := 'terminal';
		RETURN NEXT;
		RETURN;
	END IF;

	IF "job".state = 'completed' THEN
		"claim_action" := 'terminal';
		RETURN NEXT;
		RETURN;
	END IF;

	IF
		"job".state = 'running'
		AND "job".lease_expires_at IS NOT NULL
		AND "job".lease_expires_at > "now_at"
	THEN
		"claim_action" := 'busy';
		RETURN NEXT;
		RETURN;
	END IF;

	IF "job".attempts >= "input_max_attempts" THEN
		UPDATE public.scan_jobs
		SET
			lease_expires_at = NULL,
			state = 'failed',
			terminal_error = jsonb_build_object(
				'code', 'SCAN_WORKER_FAILED',
				'message', 'The queued scan could not finish after several attempts.',
				'retryable', true
			),
			updated_at = "now_at"
		WHERE job_id = "input_job_id";
		"claim_action" := 'terminal';
		RETURN NEXT;
		RETURN;
	END IF;

	SELECT count(*)::integer INTO "active_count"
	FROM public.scan_jobs AS active_job
	WHERE active_job.state = 'running'
		AND active_job.lease_expires_at > "now_at"
		AND active_job.job_id <> "input_job_id";

	IF "active_count" >= "input_max_concurrency" THEN
		"claim_action" := 'busy';
		RETURN NEXT;
		RETURN;
	END IF;

	UPDATE public.scan_jobs
	SET
		attempts = attempts + 1,
		lease_expires_at = "now_at" + make_interval(secs => "input_lease_seconds"),
		state = 'running',
		terminal_error = NULL,
		updated_at = "now_at"
	WHERE job_id = "input_job_id"
	RETURNING attempts INTO "attempt_count";

	"claim_action" := 'claimed';
	RETURN NEXT;
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public."complete_shadscan_scan_job"(
	"input_job_id" uuid,
	"input_cache_key" text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
BEGIN
	IF "input_job_id" IS NULL OR "input_cache_key" !~ '^[a-f0-9]{64}$' THEN
		RAISE EXCEPTION 'The scan-job completion is invalid.' USING ERRCODE = '22023';
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM public.scan_jobs AS job
		INNER JOIN public.scan_cache AS cache
			ON cache.cache_key = job.cache_key
			AND cache.expires_at > clock_timestamp()
		WHERE job.job_id = "input_job_id"
			AND job.cache_key = "input_cache_key"
	) THEN
		RAISE EXCEPTION 'The completed scan cache entry is unavailable.' USING ERRCODE = '23514';
	END IF;

	UPDATE public.scan_jobs
	SET
		lease_expires_at = NULL,
		result_cache_key = "input_cache_key",
		state = 'completed',
		terminal_error = NULL,
		updated_at = clock_timestamp()
	WHERE job_id = "input_job_id";
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public."record_shadscan_scan_job_failure"(
	"input_job_id" uuid,
	"input_error" jsonb,
	"input_retryable" boolean,
	"input_max_attempts" integer
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
	"resolved_state" text;
BEGIN
	IF
		"input_job_id" IS NULL
		OR jsonb_typeof("input_error") <> 'object'
		OR octet_length("input_error"::text) > 8192
		OR "input_retryable" IS NULL
		OR "input_max_attempts" NOT BETWEEN 1 AND 10
	THEN
		RAISE EXCEPTION 'The scan-job failure is invalid.' USING ERRCODE = '22023';
	END IF;

	UPDATE public.scan_jobs
	SET
		lease_expires_at = NULL,
		state = CASE
			WHEN "input_retryable" AND attempts < "input_max_attempts" THEN 'queued'
			ELSE 'failed'
		END,
		terminal_error = CASE
			WHEN "input_retryable" AND attempts < "input_max_attempts" THEN NULL
			ELSE "input_error"
		END,
		updated_at = clock_timestamp()
	WHERE job_id = "input_job_id"
	RETURNING state INTO "resolved_state";

	RETURN "resolved_state";
END;
$function$;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE public.scan_jobs FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE public.scan_jobs FROM "shadscan_runtime";
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE public.scan_job_access FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE public.scan_job_access FROM "shadscan_runtime";
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public."create_shadscan_scan_job"(uuid, text, text, text, text, text, text, integer) FROM PUBLIC;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public."get_shadscan_scan_job"(uuid, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public."claim_shadscan_scan_job"(uuid, integer, integer, integer) FROM PUBLIC;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public."complete_shadscan_scan_job"(uuid, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public."record_shadscan_scan_job_failure"(uuid, jsonb, boolean, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public."create_shadscan_scan_job"(uuid, text, text, text, text, text, text, integer) TO "shadscan_runtime";
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public."get_shadscan_scan_job"(uuid, text) TO "shadscan_runtime";
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public."claim_shadscan_scan_job"(uuid, integer, integer, integer) TO "shadscan_runtime";
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public."complete_shadscan_scan_job"(uuid, text) TO "shadscan_runtime";
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public."record_shadscan_scan_job_failure"(uuid, jsonb, boolean, integer) TO "shadscan_runtime";
