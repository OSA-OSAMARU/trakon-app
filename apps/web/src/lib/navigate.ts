/**
 * 外部サイト (Stripe の Checkout / Customer Portal) への遷移。
 *
 * 直接 window.location を触ると jsdom でテストできないため、薄いラッパにする。
 */
export function externalRedirect(url: string): void {
  window.location.assign(url);
}
