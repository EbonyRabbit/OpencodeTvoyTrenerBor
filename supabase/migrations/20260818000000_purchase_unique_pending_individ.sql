-- Защита от дублей активных заявок на индивидуальное ведение (двойной тап
-- «Связаться с тренером» / «Принимаю согласие»). Аналог
-- purchase_requests_unique_pending_per_user_program для sub_type='individ'
-- (program_id = NULL, поэтому общий индекс не срабатывает — NULLы различны).
CREATE UNIQUE INDEX purchase_requests_unique_pending_individ_per_user
  ON public.purchase_requests (telegram_id)
  WHERE sub_type = 'individ' AND status = 'pending';
