-- Защита от дублей активных заявок на покупку (двойной тап «Купить» в боте).
-- Уникальность только для status = 'pending': оплаченные/отменённые заявки
-- не мешают созданию новой покупки.
-- NULL telegram_id (заявки, созданные из веб-формы, см. фазу 21) в уникальном
-- индексе не конфликтуют: Postgres считает NULL-значения разными.
CREATE UNIQUE INDEX purchase_requests_unique_pending_per_user_program
  ON public.purchase_requests (telegram_id, program_id)
  WHERE status = 'pending';