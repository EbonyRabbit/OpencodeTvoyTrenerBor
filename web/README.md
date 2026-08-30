This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Настройка Продамуса (онлайн-оплата)

Онлайн-оплата программ работает через Продамус: клиент платит по ссылке, вебхук
подтверждает оплату и автоматически открывает доступ к программе.

### 1. Переменные окружения

Добавьте в `web/.env.local` (и на Vercel):

```bash
# Payform-ссылка платёжной страницы из кабинета Продамуса
PRODAMUS_PAYFORM_BASE_URL=https://pay.demo.prodamus.ru/payment

# Секретный ключ платёжной страницы (для проверки подписи вебхука)
PRODAMUS_SECRET_KEY=your-prodamus-secret-key
```

Боту (`bot/`) нужен только `PRODAMUS_PAYFORM_BASE_URL` - подпись проверяет
только веб.

### 2. Кабинет Продамуса

1. Скопируйте ссылку платёжной страницы (payform) в `PRODAMUS_PAYFORM_BASE_URL`.
2. В настройках страницы включите уведомление об оплате (urlNotification)
   и укажите адрес вебхука:

   ```
   https://<ваш-домен>/api/webhooks/prodamus
   ```

3. Скопируйте секретный ключ платёжной страницы в `PRODAMUS_SECRET_KEY`
   - ключ в кабинете и в env должны совпадать (по нему считается HMAC-SHA256
   подпись `Sign`).

### 3. Проверка

- Проведите тестовую оплату тестовой картой из справки Продамуса
  (help.prodamus.ru): заявка должна перейти в статус `paid`, клиенту придут
  инструкции, доступ откроется на срок программы.
- Отмените тестовый платёж: заявка станет `cancelled`, тренер получит
  уведомление в Telegram.
- Битая подпись → HTTP 400; повторная доставка вебхука по уже оплаченной
  заявке → идемпотентный ответ `{ok: true}`.

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

