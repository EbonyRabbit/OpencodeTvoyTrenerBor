-- Добавление полей для отслеживания покупок программ
-- Позволяет тренеру вручную подтверждать покупку клиента
-- и подготавливает архитектуру для будущей онлайн-оплаты (Stripe)

ALTER TABLE clients ADD COLUMN purchase_date TIMESTAMPTZ;
ALTER TABLE clients ADD COLUMN purchased_program_id UUID REFERENCES programs(id);

-- Индекс для быстрого поиска клиентов по купленной программе
CREATE INDEX idx_clients_purchased_program ON clients(purchased_program_id) WHERE purchased_program_id IS NOT NULL;

-- Комментарии к полям
COMMENT ON COLUMN clients.purchase_date IS 'Дата покупки программы (устанавливается тренером или при онлайн-оплате)';
COMMENT ON COLUMN clients.purchased_program_id IS 'UUID купленной программы (отличается от program_id — текущей активной программы)';
