import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Политика конфиденциальности - ТвойТренерБот",
  description: "Политика обработки персональных данных сервиса ТвойТренерБот",
};

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <h1 className="mb-2 text-2xl font-bold">Политика конфиденциальности</h1>
      <p className="mb-8 text-xs text-muted-foreground">
        Дата последнего обновления: 16 июля 2026 г.
      </p>

      <div className="space-y-6 text-sm leading-relaxed text-muted-foreground">
        <section>
          <h2 className="mb-2 text-base font-semibold text-foreground">
            1. Общие положения
          </h2>
          <p>
            Настоящая Политика конфиденциальности определяет порядок обработки
            персональных данных, собираемых при использовании сервиса
            &laquo;ТвойТренерБот&raquo; (далее &mdash; Сервис). Сервис
            действует в соответствии с Федеральным законом от 27.07.2006
            &laquo;О персональных данных&raquo; №152-ФЗ.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-semibold text-foreground">
            2. Какие данные мы собираем
          </h2>
          <p className="mb-2">Мы можем собирать и обрабатывать следующие данные:</p>
          <ul className="ml-4 list-inside list-disc space-y-1">
            <li>Фамилия, имя, отчество</li>
            <li>Адрес электронной почты (для входа в панель тренера)</li>
            <li>Telegram ID (для связи через бота)</li>
            <li>Параметры тела (вес, объёмы, процент жира и др.)</li>
            <li>Фотографии прогресса (вид спереди, сбоку, сзади)</li>
            <li>Данные о тренировках (упражнения, подходы, веса, RPE)</li>
            <li>Данные о самочувствии (сон, стресс, настроение)</li>
            <li>Часовой пояс и язык</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-2 text-base font-semibold text-foreground">
            3. Цели обработки
          </h2>
          <p className="mb-2">Персональные данные обрабатываются для:</p>
          <ul className="ml-4 list-inside list-disc space-y-1">
            <li>Предоставления услуг персонального фитнес-коучинга</li>
            <li>Составления и корректировки программ тренировок</li>
            <li>Отслеживания прогресса и корректировки плана</li>
            <li>Связи с клиентом через Telegram-бот</li>
            <li>Напоминаний о тренировках и замерах</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-2 text-base font-semibold text-foreground">
            4. Хранение и защита данных
          </h2>
          <p>
            Данные хранятся на защищённых серверах Supabase (PostgreSQL). Доступ
            к данным осуществляется только авторизованными пользователями
            (тренер и клиент). Фотографии хранятся в защищённом облачном
            хранилище с контролем доступа. Мы применяем технические и
            организационные меры для защиты данных от несанкционированного
            доступа.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-semibold text-foreground">
            5. Cookies
          </h2>
          <p>
            Сервис использует cookies для обеспечения работы сессии
            (аутентификации). Cookies необходимы для корректной работы сервиса
            и не используются для рекламных целей.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-semibold text-foreground">
            6. Срок хранения
          </h2>
          <p>
            Персональные данные хранятся в течение срока действия договора на
            оказание услуг. После прекращения сотрудничества данные удаляются
            в течение 30 календарных дней по запросу клиента.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-semibold text-foreground">
            7. Права клиента
          </h2>
          <p className="mb-2">Клиент имеет право:</p>
          <ul className="ml-4 list-inside list-disc space-y-1">
            <li>Получить информацию о своих персональных данных</li>
            <li>Требовать исправления неточных данных</li>
            <li>Требовать удаления своих данных</li>
            <li>Отозвать согласие на обработку данных</li>
            <li>Получить свои данные в машиночитаемом виде</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-2 text-base font-semibold text-foreground">
            8. Удаление данных
          </h2>
          <p>
            Для удаления персональных данных направьте запрос через Telegram-бот
            или на email: <strong>support@tvoitrener.ru</strong>. Удаление будет
            выполнено в течение 30 календарных дней. Фотографии удаляются
            безвозвратно.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-base font-semibold text-foreground">
            9. Контактная информация
          </h2>
          <p>
            По вопросам обработки персональных данных обращайтесь на email:{" "}
            <strong>support@tvoitrener.ru</strong> или через Telegram-бот.
          </p>
        </section>
      </div>

      <div className="mt-8 border-t pt-6">
        <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
          &larr; На главную
        </Link>
      </div>
    </div>
  );
}
