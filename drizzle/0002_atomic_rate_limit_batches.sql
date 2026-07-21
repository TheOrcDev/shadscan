CREATE OR REPLACE FUNCTION "consume_shadscan_rate_limits"("input_rules" jsonb)
RETURNS TABLE (
	"rule_name" text,
	"max_requests" integer,
	"remaining" integer,
	"reset_at_ms" bigint,
	"allowed" boolean
)
LANGUAGE plpgsql
AS $function$
DECLARE
	"rule" jsonb;
	"evaluated_rule" jsonb;
	"evaluated_rules" jsonb := '[]'::jsonb;
	"all_rules_allowed" boolean := true;
	"now_at" timestamp with time zone := clock_timestamp();
	"now_ms" bigint := floor(extract(epoch FROM "now_at") * 1000)::bigint;
	"bucket_name" text;
	"identity_value" text;
	"rule_label" text;
	"rule_limit" integer;
	"rule_window_ms" bigint;
	"current_start_ms" bigint;
	"current_start" timestamp with time zone;
	"previous_start" timestamp with time zone;
	"current_count" integer;
	"previous_count" integer;
	"weighted_previous" integer;
	"used_requests" integer;
	"rule_allowed" boolean;
	"rule_reset_at_ms" bigint;
BEGIN
	IF
		"input_rules" IS NULL
		OR jsonb_typeof("input_rules") <> 'array'
		OR jsonb_array_length("input_rules") = 0
		OR jsonb_array_length("input_rules") > 8
	THEN
		RAISE EXCEPTION 'Rate-limit rules must be a non-empty array of at most eight rules.'
			USING ERRCODE = '22023';
	END IF;

	IF (
		SELECT count(*) <> count(DISTINCT value ->> 'ruleName')
		FROM jsonb_array_elements("input_rules")
	) THEN
		RAISE EXCEPTION 'Rate-limit rule names must be unique.'
			USING ERRCODE = '22023';
	END IF;

	-- Lock every identity in a stable order before evaluating the batch.
	FOR "rule" IN
		SELECT value
		FROM jsonb_array_elements("input_rules")
		ORDER BY value ->> 'bucket', value ->> 'identityHash'
	LOOP
		"bucket_name" := "rule" ->> 'bucket';
		"identity_value" := "rule" ->> 'identityHash';
		"rule_label" := "rule" ->> 'ruleName';
		"rule_limit" := ("rule" ->> 'maxRequests')::integer;
		"rule_window_ms" := ("rule" ->> 'windowMs')::bigint;

		IF
			char_length("bucket_name") NOT BETWEEN 1 AND 128
			OR "identity_value" !~ '^[a-f0-9]{64}$'
			OR char_length("rule_label") NOT BETWEEN 1 AND 128
			OR "rule_limit" NOT BETWEEN 1 AND 1000000
			OR "rule_window_ms" NOT BETWEEN 1000 AND 604800000
		THEN
			RAISE EXCEPTION 'A rate-limit rule is invalid.'
				USING ERRCODE = '22023';
		END IF;

		PERFORM pg_advisory_xact_lock(
			hashtextextended("bucket_name" || ':' || "identity_value", 0)
		);
	END LOOP;

	-- Evaluate every rule before consuming any quota so a rejected batch is free.
	FOR "rule" IN
		SELECT value FROM jsonb_array_elements("input_rules")
	LOOP
		"bucket_name" := "rule" ->> 'bucket';
		"identity_value" := "rule" ->> 'identityHash';
		"rule_label" := "rule" ->> 'ruleName';
		"rule_limit" := ("rule" ->> 'maxRequests')::integer;
		"rule_window_ms" := ("rule" ->> 'windowMs')::bigint;
		"current_start_ms" := ("now_ms" / "rule_window_ms") * "rule_window_ms";
		"current_start" := to_timestamp(
			"current_start_ms"::double precision / 1000
		);
		"previous_start" := to_timestamp(
			("current_start_ms" - "rule_window_ms")::double precision / 1000
		);

		SELECT windows.request_count
		INTO "current_count"
		FROM rate_limit_windows AS windows
		WHERE
			windows.bucket = "bucket_name"
			AND windows.identity_hash = "identity_value"
			AND windows.window_started_at = "current_start";
		"current_count" := coalesce("current_count", 0);

		SELECT windows.request_count
		INTO "previous_count"
		FROM rate_limit_windows AS windows
		WHERE
			windows.bucket = "bucket_name"
			AND windows.identity_hash = "identity_value"
			AND windows.window_started_at = "previous_start";
		"previous_count" := coalesce("previous_count", 0);
		"weighted_previous" := floor(
			"previous_count"::numeric
			* ("rule_window_ms" - ("now_ms" - "current_start_ms"))::numeric
			/ "rule_window_ms"
		)::integer;
		"used_requests" := "current_count" + "weighted_previous";
		"rule_allowed" := "used_requests" < "rule_limit";

		IF "rule_allowed" THEN
			"rule_reset_at_ms" := "current_start_ms" + "rule_window_ms";
		ELSE
			"all_rules_allowed" := false;

			IF "current_count" < "rule_limit" THEN
				-- The previous bucket can decay enough before this bucket ends.
				"rule_reset_at_ms" := "current_start_ms"
					+ floor(
						"rule_window_ms"::numeric
						- (
							("rule_limit" - "current_count")::numeric
							* "rule_window_ms"::numeric
							/ "previous_count"::numeric
						)
					)::bigint
					+ 1;
			ELSE
				-- The current bucket must become the decaying previous bucket first.
				"rule_reset_at_ms" := "current_start_ms"
					+ "rule_window_ms"
					+ floor(
						"rule_window_ms"::numeric
						- (
							"rule_limit"::numeric
							* "rule_window_ms"::numeric
							/ "current_count"::numeric
						)
					)::bigint
					+ 1;
			END IF;
		END IF;

		"evaluated_rules" := "evaluated_rules" || jsonb_build_array(
			jsonb_build_object(
				'allowed', "rule_allowed",
				'bucket', "bucket_name",
				'currentStartMs', "current_start_ms",
				'identityHash', "identity_value",
				'maxRequests', "rule_limit",
				'previousWeighted', "weighted_previous",
				'resetAtMs', "rule_reset_at_ms",
				'ruleName', "rule_label",
				'usedRequests', "used_requests",
				'windowMs', "rule_window_ms"
			)
		);
	END LOOP;

	FOR "evaluated_rule" IN
		SELECT value FROM jsonb_array_elements("evaluated_rules")
	LOOP
		"bucket_name" := "evaluated_rule" ->> 'bucket';
		"identity_value" := "evaluated_rule" ->> 'identityHash';
		"rule_label" := "evaluated_rule" ->> 'ruleName';
		"rule_limit" := ("evaluated_rule" ->> 'maxRequests')::integer;
		"rule_window_ms" := ("evaluated_rule" ->> 'windowMs')::bigint;
		"current_start_ms" := ("evaluated_rule" ->> 'currentStartMs')::bigint;
		"current_start" := to_timestamp(
			"current_start_ms"::double precision / 1000
		);
		"weighted_previous" := ("evaluated_rule" ->> 'previousWeighted')::integer;
		"used_requests" := ("evaluated_rule" ->> 'usedRequests')::integer;
		"rule_allowed" := ("evaluated_rule" ->> 'allowed')::boolean;
		"rule_reset_at_ms" := ("evaluated_rule" ->> 'resetAtMs')::bigint;

		IF "all_rules_allowed" THEN
			INSERT INTO rate_limit_windows AS windows (
				bucket,
				expires_at,
				identity_hash,
				request_count,
				updated_at,
				window_started_at
			)
			VALUES (
				"bucket_name",
				to_timestamp(
					("current_start_ms" + (2 * "rule_window_ms") + 1000)::double precision
					/ 1000
				),
				"identity_value",
				1,
				"now_at",
				"current_start"
			)
			ON CONFLICT ON CONSTRAINT rate_limit_windows_pkey
			DO UPDATE SET
				expires_at = excluded.expires_at,
				request_count = windows.request_count + 1,
				updated_at = excluded.updated_at
			RETURNING request_count INTO "current_count";

			"used_requests" := "current_count" + "weighted_previous";
			"allowed" := true;
			"remaining" := greatest(0, "rule_limit" - "used_requests");
		ELSE
			"allowed" := "rule_allowed";
			"remaining" := greatest(0, "rule_limit" - "used_requests");
		END IF;

		"rule_name" := "rule_label";
		"max_requests" := "rule_limit";
		"reset_at_ms" := "rule_reset_at_ms";
		RETURN NEXT;
	END LOOP;

	DELETE FROM rate_limit_windows AS expired
	WHERE expired.ctid IN (
		SELECT candidate.ctid
		FROM rate_limit_windows AS candidate
		WHERE candidate.expires_at < "now_at"
		ORDER BY candidate.expires_at
		LIMIT 250
	);
END;
$function$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "consume_shadscan_rate_limits"(jsonb) FROM PUBLIC;
