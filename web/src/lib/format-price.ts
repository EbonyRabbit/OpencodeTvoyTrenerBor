export function formatPrice(price: number): string {
  return price.toLocaleString("ru-RU", { maximumFractionDigits: 0 });
}
