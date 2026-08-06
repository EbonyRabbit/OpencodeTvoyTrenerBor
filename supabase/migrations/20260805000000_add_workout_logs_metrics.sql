-- Фаза 15: суперсеты, AMRAP/круговые и кардио (бег)
-- 1. Новые метрики в workout_logs
-- heart_rate NUMERIC(4,1): валидаторы допускают 30–250, а NUMERIC(3,1)
-- вмещает только 99.9 — кардио-лог с пульсом >= 100 падал бы с overflow.
ALTER TABLE public.workout_logs
  ADD COLUMN IF NOT EXISTS rounds       INTEGER,
  ADD COLUMN IF NOT EXISTS distance_km  NUMERIC(6, 2),
  ADD COLUMN IF NOT EXISTS duration_sec INTEGER,
  ADD COLUMN IF NOT EXISTS heart_rate   NUMERIC(4, 1),
  ADD COLUMN IF NOT EXISTS pace         TEXT;

-- 2. RPC count_client_workout_days: суперсеты раскрываются в детей
-- (дети логируются отдельными строками), круг/кардио — как единица сам.
CREATE OR REPLACE FUNCTION public.count_client_workout_days(p_client_id UUID)
RETURNS BIGINT
LANGUAGE SQL
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH client_config AS (
    SELECT
      c.program_id,
      c.training_days,
      (
        NOW() AT TIME ZONE COALESCE(
          (SELECT tz.name FROM pg_catalog.pg_timezone_names tz WHERE tz.name = c.timezone),
          'Europe/Moscow'
        )
      )::DATE AS today
    FROM public.clients c
    WHERE c.id = p_client_id
  ),
  parsed_days AS (
    SELECT
      ps.id AS schedule_id,
      ps.week_number,
      ps.start_date,
      ps.end_date,
      config.training_days,
      config.today,
      CASE
        WHEN day_value->>'day_order' ~ '^\d+$'
          THEN (day_value->>'day_order')::INTEGER
        ELSE NULL
      END AS day_order,
      LOWER(BTRIM(day_value->>'day_name')) AS day_name,
      CASE
        WHEN JSONB_TYPEOF(day_value->'exercises') = 'array'
          THEN day_value->'exercises'
        ELSE '[]'::JSONB
      END AS exercises
    FROM client_config config
    JOIN public.programs program ON program.id = config.program_id
    JOIN public.program_schedule ps ON ps.client_id = p_client_id
    CROSS JOIN LATERAL JSONB_ARRAY_ELEMENTS(
      CASE
        WHEN JSONB_TYPEOF(program.parsed_content->'weeks') = 'array'
          THEN program.parsed_content->'weeks'
        ELSE '[]'::JSONB
      END
    ) week_value
    CROSS JOIN LATERAL JSONB_ARRAY_ELEMENTS(
      CASE
        WHEN JSONB_TYPEOF(week_value->'days') = 'array'
          THEN week_value->'days'
        ELSE '[]'::JSONB
      END
    ) day_value
    WHERE week_value->>'week_number' ~ '^\d+$'
      AND (week_value->>'week_number')::INTEGER = ps.week_number
      AND day_value->>'day_order' ~ '^\d+$'
      AND ps.start_date IS NOT NULL
      AND ps.end_date IS NOT NULL
      AND ps.start_date <= config.today
  ),
  date_based_days AS (
    SELECT
      parsed.schedule_id,
      parsed.week_number,
      parsed.start_date,
      parsed.end_date,
      parsed.today,
      parsed.day_order,
      planned_date::DATE AS planned_date,
      parsed.exercises,
      TRUE AS match_exact_date
    FROM parsed_days parsed
    CROSS JOIN LATERAL GENERATE_SERIES(
      parsed.start_date,
      LEAST(parsed.end_date, parsed.today),
      INTERVAL '1 day'
    ) planned_date
    WHERE COALESCE(CARDINALITY(parsed.training_days), 0) > 0
      AND ARRAY_POSITION(
        parsed.training_days,
        EXTRACT(ISODOW FROM planned_date)::INTEGER
      ) = parsed.day_order
  ),
  order_based_days AS (
    SELECT
      parsed.schedule_id,
      parsed.week_number,
      parsed.start_date,
      parsed.end_date,
      parsed.today,
      parsed.day_order,
      CASE parsed.day_name
        WHEN 'понедельник' THEN parsed.start_date
        WHEN 'вторник' THEN parsed.start_date + 1
        WHEN 'среда' THEN parsed.start_date + 2
        WHEN 'четверг' THEN parsed.start_date + 3
        WHEN 'пятница' THEN parsed.start_date + 4
        WHEN 'суббота' THEN parsed.start_date + 5
        WHEN 'воскресенье' THEN parsed.start_date + 6
        ELSE NULL
      END AS planned_date,
      parsed.exercises,
      FALSE AS match_exact_date
    FROM parsed_days parsed
    WHERE COALESCE(CARDINALITY(parsed.training_days), 0) = 0
  ),
  planned_exercises AS (
    SELECT
      planned.*,
      LOWER(BTRIM(loggable_value->>'name')) AS exercise_name
    FROM (
      SELECT * FROM date_based_days
      UNION ALL
      SELECT * FROM order_based_days
    ) planned
    CROSS JOIN LATERAL JSONB_ARRAY_ELEMENTS(planned.exercises) exercise_value
    CROSS JOIN LATERAL JSONB_ARRAY_ELEMENTS(
      CASE
        WHEN exercise_value->>'type' = 'superset'
          AND JSONB_TYPEOF(exercise_value->'children') = 'array'
          AND JSONB_ARRAY_LENGTH(exercise_value->'children') > 0
        THEN exercise_value->'children'
        ELSE JSONB_BUILD_ARRAY(exercise_value)
      END
    ) loggable_value
    WHERE BTRIM(COALESCE(loggable_value->>'name', '')) <> ''
      AND BTRIM(loggable_value->>'name') !~ '^\['
      AND (planned.planned_date IS NULL OR planned.planned_date <= planned.today)
  ),
  completed_days AS (
    SELECT
      planned.schedule_id,
      planned.day_order,
      -- NB: совпадение по имени планирует «завершённость» и для коллизий
      -- одноимённых детей разных суперсетов в один день; приемлемое
      -- упрощение для текущей модели аналитики.
      BOOL_AND(EXISTS (
        SELECT 1
        FROM public.workout_logs log
        WHERE log.client_id = p_client_id
          AND log.date <= planned.today
          AND LOWER(BTRIM(log.exercise)) = planned.exercise_name
          AND (
            (planned.match_exact_date AND log.date = planned.planned_date)
            OR (
              NOT planned.match_exact_date
              AND (
                (log.day_order = planned.day_order
                  AND log.date BETWEEN planned.start_date AND planned.end_date)
                OR (log.date = planned.planned_date
                  AND (log.day_order IS NULL OR log.day_order = planned.day_order))
              )
            )
          )
      )) AS completed
    FROM planned_exercises planned
    GROUP BY planned.schedule_id, planned.day_order
  )
  SELECT COUNT(*) FILTER (WHERE completed)
  FROM completed_days;
$$;

REVOKE ALL ON FUNCTION public.count_client_workout_days(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.count_client_workout_days(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.count_client_workout_days(UUID) TO service_role;
