-- Фаза 18: счётчик тренировок учитывает любые дни с реальными записями.
-- Раньше RPC считал только плановые дни, полностью совпавшие с датой и составом
-- упражнений. Тренировки «не по плану» (в другие дни) в счётчик не попадали.
-- Теперь «тренировок» = число дней (до today по timezone клиента), когда клиент
-- реально тренировался: есть хотя бы одна запись с реальным упражнением.
CREATE OR REPLACE FUNCTION public.count_client_workout_days(p_client_id UUID)
RETURNS BIGINT
LANGUAGE SQL
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH client_config AS (
    SELECT
      c.id AS client_id,
      (
        NOW() AT TIME ZONE COALESCE(
          (SELECT tz.name FROM pg_catalog.pg_timezone_names tz WHERE tz.name = c.timezone),
          'Europe/Moscow'
        )
      )::DATE AS today
    FROM public.clients c
    WHERE c.id = p_client_id
  )
  SELECT COUNT(DISTINCT log.date)::BIGINT
  FROM client_config config
  JOIN public.workout_logs log ON log.client_id = config.client_id
  WHERE log.date <= config.today
    AND BTRIM(COALESCE(log.exercise, '')) <> ''
    AND BTRIM(COALESCE(log.exercise, '')) !~ '^\['
$$;

REVOKE ALL ON FUNCTION public.count_client_workout_days(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.count_client_workout_days(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.count_client_workout_days(UUID) TO service_role;
