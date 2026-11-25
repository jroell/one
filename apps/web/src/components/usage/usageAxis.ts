/** An axis label for dollars: no cents on round figures, "$4K" for thousands. */
export function formatAxisUsd(value: number, locale: string): string {
  if (value === 0) return "0";
  const format = (options: Intl.NumberFormatOptions) =>
    new Intl.NumberFormat(locale, { style: "currency", currency: "USD", ...options }).format(value);
  if (value < 10) return format({ minimumFractionDigits: 0, maximumFractionDigits: 2 });
  if (value < 1000) return format({ maximumFractionDigits: 0 });
  return format({ notation: "compact", maximumFractionDigits: 1 });
}
