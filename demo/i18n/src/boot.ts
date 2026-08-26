import { type RawTranslations, i18n } from '@astroscope/i18n';

// note: fallback.* keys are intentionally missing to test fallback behavior
const mockTranslations: Record<string, RawTranslations> = {
  en: {
    // home
    'home.title': 'Welcome to our Store',
    'home.description': 'Find the best products here',
    // cart
    'cart.title': 'Shopping Cart',
    'cart.empty': 'Your cart is empty',
    'cart.items': '.input {$count :number}\n.match $count\none {{{$count} item in cart}}\n* {{{$count} items in cart}}',
    'cart.total': 'Total: {$amount}',
    'checkout.button': 'Proceed to Checkout',
    // newsletter
    'newsletter.title': 'Stay Updated',
    'newsletter.description': 'Get the latest news delivered to your inbox.',
    'newsletter.placeholder': 'Enter your email',
    'newsletter.subscribe': 'Subscribe',
    'newsletter.success': 'Thanks for subscribing!',
    // product
    'product.addToCart': 'Add to Cart',
    'product.added': 'Added to cart!',
    // cookies
    'cookies.message': 'We use cookies to improve your experience.',
    'cookies.accept': 'Accept',
    'cookies.decline': 'Decline',
    // lazy loading
    'lazy.title': 'Lazy Loading Demo',
    'lazy.description': 'Click the button to lazy-load a modal component.',
    'lazy.open_stats': 'View My Stats',
    'lazy.loading': 'Loading...',
    // stats modal
    'stats.title': 'Your Statistics',
    'stats.orders': 'Total Orders',
    'stats.spent': 'Total Spent',
    'stats.rating': 'Avg Rating',
    'stats.reviews': 'Reviews Given',
    'stats.member_since': 'Member since {$date}',
    'stats.close': 'Close',
  },
  de: {
    // home
    'home.title': 'Willkommen in unserem Shop',
    'home.description': 'Finden Sie hier die besten Produkte',
    // cart
    'cart.title': 'Warenkorb',
    'cart.empty': 'Ihr Warenkorb ist leer',
    'cart.items':
      '.input {$count :number}\n.match $count\none {{{$count} Artikel im Warenkorb}}\n* {{{$count} Artikel im Warenkorb}}',
    'cart.total': 'Gesamt: {$amount}',
    'checkout.button': 'Zur Kasse',
    // newsletter
    'newsletter.title': 'Bleiben Sie informiert',
    'newsletter.description': 'Erhalten Sie die neuesten Nachrichten direkt in Ihren Posteingang.',
    'newsletter.placeholder': 'E-Mail eingeben',
    'newsletter.subscribe': 'Abonnieren',
    'newsletter.success': 'Danke für Ihre Anmeldung!',
    // product
    'product.addToCart': 'In den Warenkorb',
    'product.added': 'Hinzugefügt!',
    // cookies
    'cookies.message': 'Wir verwenden Cookies, um Ihre Erfahrung zu verbessern.',
    'cookies.accept': 'Akzeptieren',
    'cookies.decline': 'Ablehnen',
    // lazy loading
    'lazy.title': 'Lazy-Loading Demo',
    'lazy.description': 'Klicken Sie auf die Schaltfläche, um eine Modal-Komponente zu laden.',
    'lazy.open_stats': 'Meine Statistiken',
    'lazy.loading': 'Wird geladen...',
    // stats modal
    'stats.title': 'Ihre Statistiken',
    'stats.orders': 'Bestellungen',
    'stats.spent': 'Ausgegeben',
    'stats.rating': 'Bewertung',
    'stats.reviews': 'Rezensionen',
    'stats.member_since': 'Mitglied seit {$date}',
    'stats.close': 'Schließen',
  },
};

async function fetchTranslations(locale: string): Promise<RawTranslations> {
  // in production, this would call your actual CMS
  console.log(`[i18n] fetching translations for locale: ${locale}`);
  return mockTranslations[locale] ?? mockTranslations['en'] ?? {};
}

export async function onStartup() {
  await new Promise((resolve) => setTimeout(resolve, 1000)); // simulate async setup work

  await i18n.configure({ locales: ['en', 'de'] });

  console.log('[i18n] loading translations...');

  const [en, de] = await Promise.all([fetchTranslations('en'), fetchTranslations('de')]);

  i18n.setTranslations('en', en);
  i18n.setTranslations('de', de);

  console.log('[i18n] translations ready');
}
