(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const els = {
    header: $('#siteHeader'), overlay: $('#overlay'), mobileMenu: $('#mobileMenu'),
    cartDrawer: $('#cartDrawer'), searchPanel: $('#searchPanel'), productModal: $('#productModal'),
    checkoutModal: $('#checkoutModal'), categoriesGrid: $('#categoriesGrid'),
    featuredGrid: $('#featuredGrid'), newGrid: $('#newGrid'), categoryFilters: $('#categoryFilters'),
    cartItems: $('#cartItems'), cartFooter: $('#cartFooter'), cartCount: $('#cartCount'),
    cartTitleCount: $('#cartTitleCount'), cartSubtotal: $('#cartSubtotal'),
    searchInput: $('#searchInput'), searchResults: $('#searchResults'),
    productModalContent: $('#productModalContent'), governorate: $('#governorateSelect'),
    checkoutForm: $('#checkoutForm'), toast: $('#toast'), toastText: $('#toastText'), toastIcon: $('#toastIcon')
  };

  const state = {
    catalog: null,
    products: [],
    cart: loadCart(),
    filter: 'all',
    openElement: null,
    modalProduct: null,
    modalQty: 1,
    toastTimer: null
  };

  const numberFormatter = new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 2 });

  function escapeHTML(value = '') {
    return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  }

  function formatPrice(value, currency = state.catalog?.settings?.currency || 'ج.م') {
    return `${numberFormatter.format(Number(value) || 0)} ${escapeHTML(currency)}`;
  }

  function normalize(value = '') {
    return String(value)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u064B-\u065F\u0670]/g, '')
      .replace(/[أإآ]/g, 'ا')
      .replace(/ة/g, 'ه')
      .replace(/ى/g, 'ي')
      .trim();
  }

  function loadCart() {
    try {
      const parsed = JSON.parse(localStorage.getItem('athar-cart-v1'));
      if (Array.isArray(parsed)) return parsed.filter(item => item?.id && Number(item.quantity) > 0);
    } catch {}
    return [];
  }

  function saveCart() {
    localStorage.setItem('athar-cart-v1', JSON.stringify(state.cart));
  }

  function icon(name) {
    const icons = {
      arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 12h10M11 8l-4 4 4 4"/></svg>',
      eye: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.5"/></svg>',
      trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></svg>',
      bag: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 8.5h11l-.7 11h-9.6l-.7-11Z"/><path d="M9 9V6.8a3 3 0 0 1 6 0V9"/></svg>',
      instagram: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><path d="M17.5 6.5h.01"/></svg>',
      facebook: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 21v-8h3l.5-3H14V8.2c0-.9.4-1.7 1.8-1.7H18V3.8c-.4 0-1.7-.2-3-.2-3 0-4.8 1.8-4.8 5V10H7v3h3.2v8"/></svg>',
      whatsapp: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M27.2 4.7A15.6 15.6 0 0 0 2.7 23.5L.5 31.5l8.2-2.1A15.6 15.6 0 0 0 27.2 4.7Zm-11 23.4c-2.4 0-4.7-.6-6.7-1.8l-.5-.3-4.8 1.3 1.3-4.7-.3-.5A12.6 12.6 0 1 1 16.2 28Z"/></svg>'
    };
    return icons[name] || '';
  }

  const config = window.ATHAR_CONFIG || {};

  function pick(row, keys, fallback = '') {
    for (const key of keys) {
      const value = row?.[key];
      if (value !== undefined && value !== null && String(value).trim() !== '') return value;
    }
    return fallback;
  }

  function isYes(value, fallback = false) {
    const text = String(value ?? '').trim().toLowerCase();
    if (!text) return fallback;
    return ['نعم', 'yes', 'true', '1', 'y', 'متاح'].includes(text);
  }

  function numeric(value, fallback = 0) {
    const arabic = '٠١٢٣٤٥٦٧٨٩';
    const normalized = String(value ?? '').replace(/,/g, '').replace(/[٠-٩]/g, digit => arabic.indexOf(digit));
    const result = Number(normalized);
    return Number.isFinite(result) ? result : fallback;
  }

  function sheetImageUrl(value) {
    const image = String(value || '').trim();
    if (!image) return 'assets/product-placeholder.svg';
    const driveId = image.match(/drive\.google\.com\/file\/d\/([^/]+)/)?.[1]
      || image.match(/[?&]id=([^&]+)/)?.[1];
    if (driveId) return `https://drive.google.com/thumbnail?id=${encodeURIComponent(driveId)}&sz=w1400`;
    if (/^https?:\/\//i.test(image) || image.startsWith('data:')) return image;
    const clean = image.replace(/^\.?\//, '');
    if (clean.includes('/')) return clean;
    return `uploads/${encodeURIComponent(clean)}`;
  }

  function splitImages(value) {
    return String(value || '').split(/[,،;\n]+/).map(item => item.trim()).filter(Boolean).map(sheetImageUrl);
  }

  async function fetchSheetRows(sheetName) {
    const sheetId = config.sheetId;
    if (!sheetId) throw new Error('لم يتم تحديد Google Sheet');
    const refreshWindow = Math.max(1, Number(config.refreshMinutes) || 2) * 60 * 1000;
    const cacheKey = Math.floor(Date.now() / refreshWindow);
    const endpoint = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/gviz/tq?tqx=out:json&headers=1&sheet=${encodeURIComponent(sheetName)}&_=${cacheKey}`;
    const response = await fetch(endpoint, { cache: 'no-store' });
    if (!response.ok) throw new Error(`تعذر قراءة شيت ${sheetName}`);
    const text = await response.text();
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end < start) throw new Error(`استجابة غير صالحة من شيت ${sheetName}`);
    const payload = JSON.parse(text.slice(start, end + 1));
    if (payload.status !== 'ok') throw new Error(payload.errors?.[0]?.detailed_message || `شيت ${sheetName} غير متاح`);
    const table = payload.table || {};
    const headers = (table.cols || []).map((column, index) => String(column.label || column.id || `column_${index}`).trim());
    return (table.rows || []).map(row => {
      const object = {};
      headers.forEach((header, index) => {
        const cell = row.c?.[index];
        object[header] = cell?.v ?? '';
      });
      return object;
    }).filter(row => Object.values(row).some(value => String(value ?? '').trim() !== ''));
  }

  async function loadGoogleCatalog() {
    const names = {
      products: 'المنتجات', categories: 'الفئات', settings: 'إعدادات المتجر',
      shipping: 'الشحن', reviews: 'آراء العملاء', ...(config.sheetNames || {})
    };
    const [productRows, categoryRows, settingRows, shippingRows, reviewRows] = await Promise.all([
      fetchSheetRows(names.products), fetchSheetRows(names.categories), fetchSheetRows(names.settings),
      fetchSheetRows(names.shipping), fetchSheetRows(names.reviews)
    ]);
    if (!productRows.length) throw new Error('شيت المنتجات فارغ');

    const settings = {
      storeName: 'أثر', whatsapp: '201030263241', currency: 'ج.م',
      announcement: 'شحن لكل محافظات مصر • تأكيد الطلب عبر واتساب',
      heroTitle: 'تفاصيل صغيرة، تصنع أثرًا كبيرًا',
      heroSubtitle: 'منتجات منتقاة لترافق أيامك وتترك لمسة لا تُنسى.',
      heroImage: 'uploads/hero-athar.jpg', heroButton: 'اكتشف المجموعة',
      categoriesTitle: 'اختار اللي يناسب يومك', featuredTitle: 'اختيارات صنعت لتبقى',
      newTitle: 'وصل حديثًا', reviewsTitle: 'كلام ترك أثرًا', aboutTitle: 'كل تفصيلة لها معنى',
      aboutText: 'في أثر نختار كل قطعة بهدوء واهتمام، علشان توصلك حاجة بسيطة لكن تفضل معاك.',
      instagram: '', facebook: '', email: '',
      shippingNote: 'تكلفة الشحن تُحسب حسب المحافظة ويتم تأكيد الطلب عبر واتساب.',
      footerNote: 'مصنوع بحب ليترك أثرًا جميلًا.', primaryColor: '#111111', accentColor: '#c9a452'
    };
    const aliases = {
      'اسم المتجر': 'storeName', 'رقم واتساب': 'whatsapp', 'رقم واتساب (دولي بدون +)': 'whatsapp',
      'العملة': 'currency', 'شريط الإعلان': 'announcement', 'رسالة الشريط العلوي': 'announcement',
      'عنوان الواجهة': 'heroTitle', 'وصف الواجهة': 'heroSubtitle', 'صورة الواجهة': 'heroImage',
      'نص زر الواجهة': 'heroButton', 'عنوان قسم الفئات': 'categoriesTitle',
      'عنوان المنتجات المميزة': 'featuredTitle', 'عنوان وصل حديثًا': 'newTitle',
      'عنوان آراء العملاء': 'reviewsTitle', 'عنوان من نحن': 'aboutTitle', 'نص من نحن': 'aboutText',
      'إنستجرام': 'instagram', 'رابط إنستجرام': 'instagram', 'فيسبوك': 'facebook',
      'بريد إلكتروني': 'email', 'ملاحظة الشحن': 'shippingNote', 'رسالة أسفل الصفحة': 'footerNote',
      'اللون الأساسي (اختياري)': 'primaryColor', 'اللون المساعد (اختياري)': 'accentColor'
    };
    settingRows.forEach(row => {
      const key = aliases[String(pick(row, ['الإعداد', 'المفتاح'])).trim()];
      const value = pick(row, ['القيمة', 'Value']);
      if (key && String(value ?? '').trim() !== '') settings[key] = String(value).trim();
    });
    settings.whatsapp = String(settings.whatsapp).replace(/\D/g, '');
    settings.heroImage = sheetImageUrl(settings.heroImage);

    const products = productRows.map((row, index) => {
      const mainImage = sheetImageUrl(pick(row, ['الصورة الرئيسية', 'اسم ملف الصورة الرئيسية', 'image']));
      const extras = splitImages(pick(row, ['صور إضافية', 'أسماء الصور الإضافية (افصل بفاصلة)', 'gallery']));
      return {
        id: String(pick(row, ['معرّف المنتج', 'معرف المنتج', 'product_id'], `product-${index + 1}`)).trim(),
        name: String(pick(row, ['اسم المنتج', 'name'], 'منتج بدون اسم')).trim(),
        category: String(pick(row, ['الفئة', 'category'], 'منتجات')).trim(),
        price: numeric(pick(row, ['السعر', 'price'])),
        oldPrice: numeric(pick(row, ['السعر قبل الخصم', 'السعر قبل الخصم (اختياري)', 'old_price'])),
        shortDescription: String(pick(row, ['وصف قصير', 'short_description'])).trim(),
        description: String(pick(row, ['الوصف الكامل', 'description'])).trim(),
        image: mainImage, images: [mainImage, ...extras.filter(item => item !== mainImage)],
        available: isYes(pick(row, ['متوفر', 'متوفر؟', 'available']), true),
        featured: isYes(pick(row, ['مميز', 'منتج مميز؟', 'featured'])),
        isNew: isYes(pick(row, ['وصل حديثًا', 'وصل حديثاً', 'وصل حديثًا؟', 'new'])),
        order: numeric(pick(row, ['الترتيب', 'order']), index + 1),
        material: String(pick(row, ['الخامة', 'material'])).trim(),
        size: String(pick(row, ['المقاس', 'size'])).trim()
      };
    }).filter(product => product.available && product.id && product.name).sort((a, b) => a.order - b.order);
    if (!products.length) throw new Error('لا توجد منتجات متاحة في Google Sheet');

    let categories = categoryRows.map((row, index) => ({
      id: String(pick(row, ['معرّف الفئة', 'معرف الفئة', 'category_id'], `category-${index + 1}`)).trim(),
      name: String(pick(row, ['اسم الفئة', 'الفئة', 'name'])).trim(),
      image: sheetImageUrl(pick(row, ['صورة الفئة', 'اسم ملف صورة الفئة', 'image'])),
      description: String(pick(row, ['وصف قصير', 'description'])).trim(),
      order: numeric(pick(row, ['الترتيب', 'order']), index + 1)
    })).filter(category => category.name).sort((a, b) => a.order - b.order);
    if (!categories.length) categories = [...new Set(products.map(product => product.category))].map((name, index) => ({ id: `category-${index + 1}`, name, image: products.find(product => product.category === name)?.image, description: '', order: index + 1 }));

    const shipping = shippingRows.map(row => ({
      governorate: String(pick(row, ['المحافظة', 'governorate'])).trim(),
      cost: numeric(pick(row, ['التكلفة', 'السعر', 'cost'])),
      available: isYes(pick(row, ['متاح', 'available']), true)
    })).filter(item => item.governorate && item.available);
    const reviews = reviewRows.map((row, index) => ({
      name: String(pick(row, ['الاسم', 'name'], 'عميل أثر')).trim(),
      text: String(pick(row, ['الرأي', 'النص', 'review'])).trim(),
      rating: Math.min(5, Math.max(1, numeric(pick(row, ['التقييم', 'rating']), 5))),
      order: numeric(pick(row, ['الترتيب', 'order']), index + 1),
      visible: isYes(pick(row, ['ظاهر', 'visible']), true)
    })).filter(review => review.text && review.visible).sort((a, b) => a.order - b.order);
    return { settings, products, categories, shipping, reviews, meta: { source: 'google-sheets', updatedAt: new Date().toISOString() } };
  }

  async function loadCatalogSource() {
    if (config.sheetId) {
      try {
        const catalog = await loadGoogleCatalog();
        console.info('Athar catalog loaded from Google Sheets.');
        return catalog;
      } catch (error) {
        console.warn('Google Sheets unavailable; using local fallback.', error.message);
      }
    }
    const response = await fetch(config.fallbackDataUrl || 'data/store.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('تعذر تحميل بيانات المتجر الاحتياطية');
    return response.json();
  }

  async function loadStore() {
    try {
      state.catalog = await loadCatalogSource();
      state.products = state.catalog.products || [];
      const validIds = new Set(state.products.map(product => product.id));
      state.cart = state.cart.filter(item => validIds.has(item.id));
      saveCart();
      applySettings();
      renderCategories();
      renderFilters();
      renderProducts();
      renderReviews();
      populateGovernorates();
      renderCart();
      openProductFromUrl();
      setupReveals();
    } catch (error) {
      console.error(error);
      const failure = '<div class="empty-products"><strong>حصلت مشكلة في تحميل المنتجات</strong><span>جرّب تحديث الصفحة بعد لحظات.</span></div>';
      els.featuredGrid.innerHTML = failure;
      els.newGrid.innerHTML = failure;
      els.categoriesGrid.innerHTML = failure;
      showToast('تعذر تحميل بيانات المتجر', false);
    }
  }

  function applySettings() {
    const s = state.catalog.settings;
    document.title = `${s.storeName} | تفاصيل تصنع فرقًا`;
    const textMap = {
      '#announcementText': s.announcement, '#brandName': s.storeName,
      '#heroSubtitle': s.heroSubtitle, '#categoriesTitle': s.categoriesTitle,
      '#featuredTitle': s.featuredTitle, '#newTitle': s.newTitle, '#reviewsTitle': s.reviewsTitle,
      '#aboutTitle': s.aboutTitle, '#aboutText': s.aboutText, '#footerNote': s.footerNote
    };
    for (const [selector, value] of Object.entries(textMap)) {
      const element = $(selector);
      if (element && value) element.textContent = value;
    }
    $$('.brand strong').forEach(element => { element.textContent = s.storeName; });
    const titleParts = String(s.heroTitle || '').split(/،|\n/).map(part => part.trim()).filter(Boolean);
    $('#heroTitle').innerHTML = titleParts.length > 1
      ? `${escapeHTML(titleParts[0])}،<br><em>${escapeHTML(titleParts.slice(1).join('، '))}</em>`
      : escapeHTML(s.heroTitle);
    $('#heroButton').innerHTML = `${escapeHTML(s.heroButton)} ${icon('arrow')}`;
    if (s.heroImage) $('#heroImage').src = s.heroImage;
    if (/^#[0-9a-f]{6}$/i.test(s.primaryColor || '')) document.documentElement.style.setProperty('--ink', s.primaryColor);
    if (/^#[0-9a-f]{6}$/i.test(s.accentColor || '')) document.documentElement.style.setProperty('--gold', s.accentColor);

    const genericMessage = encodeURIComponent(`أهلًا، محتاج أعرف أكتر عن منتجات ${s.storeName}.`);
    const whatsappUrl = `https://wa.me/${s.whatsapp}?text=${genericMessage}`;
    ['#heroWhatsapp', '#storyWhatsapp', '#ctaWhatsapp', '#footerWhatsapp', '#floatingWhatsapp', '#mobileWhatsapp']
      .forEach(selector => { const item = $(selector); if (item) item.href = whatsappUrl; });
    $('#whatsappDisplay').textContent = prettyPhone(s.whatsapp);
    $('#year').textContent = new Date().getFullYear();
    renderSocialLinks(whatsappUrl);
  }

  function prettyPhone(phone) {
    const digits = String(phone || '').replace(/\D/g, '');
    if (digits.startsWith('20') && digits.length === 12) return `+20 ${digits.slice(2, 5)} ${digits.slice(5, 8)} ${digits.slice(8)}`;
    return `+${digits}`;
  }

  function renderSocialLinks(whatsappUrl) {
    const s = state.catalog.settings;
    const links = [];
    if (s.instagram) links.push(`<a href="${escapeHTML(s.instagram)}" target="_blank" rel="noopener" aria-label="إنستجرام">${icon('instagram')}</a>`);
    if (s.facebook) links.push(`<a href="${escapeHTML(s.facebook)}" target="_blank" rel="noopener" aria-label="فيسبوك">${icon('facebook')}</a>`);
    links.push(`<a href="${whatsappUrl}" target="_blank" rel="noopener" aria-label="واتساب">${icon('whatsapp')}</a>`);
    $('#socialLinks').innerHTML = links.join('');
  }

  function renderCategories() {
    const categories = state.catalog.categories || [];
    els.categoriesGrid.innerHTML = categories.map(category => `
      <article class="category-card reveal" role="button" tabindex="0" data-category="${escapeHTML(category.id === 'new' ? '__new' : category.name)}" aria-label="عرض قسم ${escapeHTML(category.name)}">
        <div class="category-card__image">
          <img src="${escapeHTML(category.image)}" alt="${escapeHTML(category.name)}" loading="lazy">
          <span class="category-card__arrow">${icon('arrow')}</span>
        </div>
        <div class="category-card__body"><h3>${escapeHTML(category.name)}</h3><span>${escapeHTML(category.description || 'اكتشف المجموعة')}</span></div>
      </article>`).join('');
    attachImageFallbacks(els.categoriesGrid);
  }

  function renderFilters() {
    const availableNames = new Set(state.products.map(product => product.category));
    const categories = state.catalog.categories.filter(category => availableNames.has(category.name));
    els.categoryFilters.innerHTML = [
      '<button class="filter-pill is-active" type="button" data-filter="all">الكل</button>',
      ...categories.map(category => `<button class="filter-pill" type="button" data-filter="${escapeHTML(category.name)}">${escapeHTML(category.name)}</button>`)
    ].join('');
  }

  function productCard(product) {
    const sale = product.oldPrice > product.price && product.oldPrice > 0;
    const discount = sale ? Math.round((1 - product.price / product.oldPrice) * 100) : 0;
    return `<article class="product-card reveal" data-product-card="${escapeHTML(product.id)}">
      <div class="product-card__media" data-open-product="${escapeHTML(product.id)}" role="button" tabindex="0" aria-label="عرض ${escapeHTML(product.name)}">
        <img src="${escapeHTML(product.image)}" alt="${escapeHTML(product.name)}" loading="lazy">
        <div class="product-badges">
          ${product.isNew ? '<span class="product-badge">جديد</span>' : ''}
          ${sale ? `<span class="product-badge product-badge--sale">خصم ${numberFormatter.format(discount)}٪</span>` : ''}
        </div>
        <button class="quick-view" type="button" data-open-product="${escapeHTML(product.id)}" aria-label="معاينة ${escapeHTML(product.name)}">${icon('eye')}</button>
        <button class="product-card__add" type="button" data-add="${escapeHTML(product.id)}">أضف للسلة</button>
      </div>
      <div class="product-card__body">
        <span class="product-card__category">${escapeHTML(product.category)}</span>
        <h3 class="product-card__title"><button type="button" data-open-product="${escapeHTML(product.id)}">${escapeHTML(product.name)}</button></h3>
        <div class="product-card__price"><strong>${formatPrice(product.price)}</strong>${sale ? `<del>${formatPrice(product.oldPrice)}</del>` : ''}</div>
      </div>
    </article>`;
  }

  function renderProducts() {
    let selected = state.products;
    if (state.filter === '__new') selected = selected.filter(product => product.isNew);
    else if (state.filter !== 'all') selected = selected.filter(product => product.category === state.filter);
    els.featuredGrid.innerHTML = selected.length
      ? selected.map(productCard).join('')
      : '<div class="empty-products"><strong>مفيش منتجات في القسم ده حاليًا</strong><span>جرّب قسم تاني أو ارجع لكل المنتجات.</span></div>';

    const newest = state.products.filter(product => product.isNew).slice(0, 4);
    els.newGrid.innerHTML = (newest.length ? newest : state.products.slice(0, 4)).map(productCard).join('');
    attachImageFallbacks(els.featuredGrid);
    attachImageFallbacks(els.newGrid);
    setupReveals();
  }

  function renderReviews() {
    const reviews = state.catalog.reviews || [];
    const target = $('#reviewsGrid');
    if (!reviews.length) {
      $('#reviews').hidden = true;
      return;
    }
    target.innerHTML = reviews.map(review => `
      <article class="review-card reveal">
        <div class="review-stars" aria-label="${review.rating} من 5">${'★'.repeat(review.rating)}${'☆'.repeat(5 - review.rating)}</div>
        <blockquote>${escapeHTML(review.text)}</blockquote>
        <div class="review-author"><span>${escapeHTML(review.name.slice(0, 1))}</span><div><strong>${escapeHTML(review.name)}</strong><small>من عملاء أثر</small></div></div>
      </article>`).join('');
  }

  function attachImageFallbacks(root = document) {
    $$('img', root).forEach(image => {
      image.addEventListener('error', () => {
        if (!image.src.endsWith('/assets/product-placeholder.svg')) image.src = 'assets/product-placeholder.svg';
      }, { once: true });
    });
  }

  function setFilter(filter) {
    state.filter = filter;
    $$('.filter-pill', els.categoryFilters).forEach(button => button.classList.toggle('is-active', button.dataset.filter === filter));
    renderProducts();
    $('#featured').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function findProduct(id) {
    return state.products.find(product => product.id === id);
  }

  function addToCart(id, quantity = 1) {
    const product = findProduct(id);
    if (!product) return;
    const existing = state.cart.find(item => item.id === id);
    if (existing) existing.quantity = Math.min(99, existing.quantity + Number(quantity || 1));
    else state.cart.push({ id, quantity: Math.max(1, Number(quantity) || 1) });
    saveCart();
    renderCart();
    showToast(`تمت إضافة «${product.name}» للسلة`);
    els.cartCount.classList.remove('is-bump');
    requestAnimationFrame(() => els.cartCount.classList.add('is-bump'));
  }

  function updateCart(id, delta) {
    const item = state.cart.find(entry => entry.id === id);
    if (!item) return;
    item.quantity += delta;
    if (item.quantity <= 0) state.cart = state.cart.filter(entry => entry.id !== id);
    saveCart();
    renderCart();
  }

  function removeFromCart(id) {
    state.cart = state.cart.filter(entry => entry.id !== id);
    saveCart();
    renderCart();
    showToast('تم حذف المنتج من السلة');
  }

  function cartDetails() {
    return state.cart.map(item => ({ ...item, product: findProduct(item.id) })).filter(item => item.product);
  }

  function cartSubtotal() {
    return cartDetails().reduce((sum, item) => sum + item.product.price * item.quantity, 0);
  }

  function renderCart() {
    const details = cartDetails();
    const quantity = details.reduce((sum, item) => sum + item.quantity, 0);
    els.cartCount.textContent = numberFormatter.format(quantity);
    els.cartTitleCount.textContent = `(${numberFormatter.format(quantity)})`;
    els.cartSubtotal.textContent = formatPrice(cartSubtotal()).replace(/&amp;/g, '&');
    els.cartFooter.hidden = details.length === 0;

    if (!details.length) {
      els.cartItems.innerHTML = `<div class="empty-cart"><div><span class="empty-cart__icon">${icon('bag')}</span><h3>سلتك لسه فاضية</h3><p>اختار التفاصيل اللي عجبتك وهنحفظها لك هنا.</p><button class="button button--outline" type="button" data-close>ابدأ التسوق</button></div></div>`;
      return;
    }
    els.cartItems.innerHTML = details.map(({ product, quantity: qty }) => `
      <article class="cart-item">
        <img src="${escapeHTML(product.image)}" alt="${escapeHTML(product.name)}">
        <div class="cart-item__info"><small>${escapeHTML(product.category)}</small><h3>${escapeHTML(product.name)}</h3><strong>${formatPrice(product.price)}</strong>
          <div class="quantity" aria-label="الكمية"><button type="button" data-cart-plus="${escapeHTML(product.id)}" aria-label="زيادة">+</button><span>${numberFormatter.format(qty)}</span><button type="button" data-cart-minus="${escapeHTML(product.id)}" aria-label="تقليل">−</button></div>
        </div>
        <button class="icon-btn cart-item__remove" type="button" data-remove="${escapeHTML(product.id)}" aria-label="حذف ${escapeHTML(product.name)}">${icon('trash')}</button>
      </article>`).join('');
    attachImageFallbacks(els.cartItems);
  }

  function openProduct(id, updateUrl = true) {
    const product = findProduct(id);
    if (!product) return;
    state.modalProduct = product;
    state.modalQty = 1;
    const sale = product.oldPrice > product.price;
    els.productModalContent.innerHTML = `
      <div class="product-modal__visual"><img src="${escapeHTML(product.image)}" alt="${escapeHTML(product.name)}"></div>
      <div class="product-modal__details">
        <span class="kicker">${escapeHTML(product.category)}${product.isNew ? ' • وصل حديثًا' : ''}</span>
        <h2 id="productModalTitle">${escapeHTML(product.name)}</h2>
        <div class="product-modal__price"><strong>${formatPrice(product.price)}</strong>${sale ? `<del>${formatPrice(product.oldPrice)}</del>` : ''}</div>
        <p class="product-modal__desc">${escapeHTML(product.description || product.shortDescription || 'منتج مختار بعناية من أثر.')}</p>
        ${(product.material || product.size) ? `<div class="product-modal__meta">${product.material ? `<div><span>الخامة</span><strong>${escapeHTML(product.material)}</strong></div>` : ''}${product.size ? `<div><span>المقاس</span><strong>${escapeHTML(product.size)}</strong></div>` : ''}</div>` : ''}
        <div class="product-modal__buy">
          <div class="quantity"><button type="button" data-modal-plus aria-label="زيادة">+</button><span id="modalQty">١</span><button type="button" data-modal-minus aria-label="تقليل">−</button></div>
          <button class="button button--dark" type="button" data-modal-add>أضف للسلة</button>
        </div>
        <p class="product-modal__foot">تأكيد التوفر وتفاصيل الشحن بيتم على واتساب.</p>
      </div>`;
    attachImageFallbacks(els.productModalContent);
    openUI(els.productModal);
    if (updateUrl) {
      const url = new URL(location.href);
      url.searchParams.set('product', product.id);
      history.replaceState({}, '', url);
    }
  }

  function updateModalQty(delta) {
    state.modalQty = Math.max(1, Math.min(99, state.modalQty + delta));
    $('#modalQty').textContent = numberFormatter.format(state.modalQty);
  }

  function openProductFromUrl() {
    const id = new URLSearchParams(location.search).get('product');
    if (id && findProduct(id)) setTimeout(() => openProduct(id, false), 150);
  }

  function openUI(element) {
    if (!element) return;
    if (state.openElement && state.openElement !== element) closeUI(false);
    state.openElement = element;
    element.classList.add('is-open');
    element.setAttribute('aria-hidden', 'false');
    els.overlay.classList.add('is-active');
    document.body.classList.add('is-locked');
    const focusable = $('input, button, select, textarea, a[href]', element);
    if (element === els.searchPanel) setTimeout(() => els.searchInput.focus(), 220);
    else if (focusable) setTimeout(() => focusable.focus(), 80);
  }

  function closeUI(clearProductUrl = true) {
    $$('.is-open').forEach(element => {
      element.classList.remove('is-open');
      if (element.hasAttribute('aria-hidden')) element.setAttribute('aria-hidden', 'true');
    });
    els.overlay.classList.remove('is-active');
    document.body.classList.remove('is-locked');
    $('#menuToggle').setAttribute('aria-expanded', 'false');
    state.openElement = null;
    if (clearProductUrl && new URLSearchParams(location.search).has('product')) {
      const url = new URL(location.href);
      url.searchParams.delete('product');
      history.replaceState({}, '', url.pathname + url.search + url.hash);
    }
  }

  function renderSearch(query) {
    const term = normalize(query);
    if (!term) {
      els.searchResults.innerHTML = '<p class="search-hint">ابدأ الكتابة علشان تظهر لك النتائج.</p>';
      return;
    }
    const results = state.products.filter(product => normalize(`${product.name} ${product.category} ${product.shortDescription}`).includes(term)).slice(0, 8);
    if (!results.length) {
      els.searchResults.innerHTML = '<p class="search-empty">ملقيناش نتيجة بنفس الاسم. جرّب كلمة أقصر أو اسم القسم.</p>';
      return;
    }
    els.searchResults.innerHTML = results.map(product => `
      <button class="search-result" type="button" data-search-product="${escapeHTML(product.id)}">
        <img src="${escapeHTML(product.image)}" alt=""><span><strong>${escapeHTML(product.name)}</strong><small>${formatPrice(product.price)}</small></span>
      </button>`).join('');
    attachImageFallbacks(els.searchResults);
  }

  function populateGovernorates() {
    els.governorate.innerHTML = '<option value="">اختار المحافظة</option>' + (state.catalog.shipping || [])
      .map(item => `<option value="${escapeHTML(item.governorate)}" data-cost="${item.cost}">${escapeHTML(item.governorate)} — ${formatPrice(item.cost)}</option>`).join('');
  }

  function selectedShipping() {
    const option = els.governorate.selectedOptions[0];
    return option?.value ? Number(option.dataset.cost || 0) : null;
  }

  function updateCheckoutSummary() {
    const subtotal = cartSubtotal();
    const shipping = selectedShipping();
    $('#checkoutSubtotal').textContent = formatPrice(subtotal).replace(/&amp;/g, '&');
    $('#checkoutShipping').textContent = shipping === null ? 'اختر المحافظة' : formatPrice(shipping).replace(/&amp;/g, '&');
    $('#checkoutTotal').textContent = formatPrice(subtotal + (shipping || 0)).replace(/&amp;/g, '&');
  }

  function openCheckout() {
    if (!state.cart.length) return showToast('أضف منتجًا للسلة الأول', false);
    closeUI(false);
    updateCheckoutSummary();
    setTimeout(() => openUI(els.checkoutModal), 60);
  }

  function submitCheckout(event) {
    event.preventDefault();
    const form = event.currentTarget;
    $$('input, select, textarea', form).forEach(field => field.classList.remove('is-invalid'));
    if (!form.checkValidity()) {
      $$(':invalid', form).forEach(field => field.classList.add('is-invalid'));
      form.reportValidity();
      return;
    }
    const values = Object.fromEntries(new FormData(form));
    const phoneDigits = String(values.phone || '').replace(/\D/g, '');
    if (phoneDigits.length < 10) {
      form.elements.phone.classList.add('is-invalid');
      form.elements.phone.focus();
      return showToast('اكتب رقم موبايل صحيح', false);
    }
    const shipping = selectedShipping() || 0;
    const subtotal = cartSubtotal();
    const total = subtotal + shipping;
    const items = cartDetails();
    const orderId = `ATH-${Date.now().toString().slice(-7)}`;
    const lines = items.map((item, index) => `${index + 1}) ${item.product.name}\n   ${item.quantity} × ${numberFormatter.format(item.product.price)} = ${numberFormatter.format(item.product.price * item.quantity)} ${state.catalog.settings.currency}`);
    const message = [
      `طلب جديد من متجر ${state.catalog.settings.storeName} ✨`,
      `رقم الطلب: ${orderId}`,
      '',
      `الاسم: ${values.name}`,
      `الموبايل: ${values.phone}`,
      `المحافظة: ${values.governorate}`,
      `المدينة / المنطقة: ${values.city}`,
      `العنوان: ${values.address}`,
      values.notes ? `ملاحظات: ${values.notes}` : '',
      '',
      'المنتجات:',
      ...lines,
      '',
      `إجمالي المنتجات: ${numberFormatter.format(subtotal)} ${state.catalog.settings.currency}`,
      `الشحن: ${numberFormatter.format(shipping)} ${state.catalog.settings.currency}`,
      `الإجمالي: ${numberFormatter.format(total)} ${state.catalog.settings.currency}`,
      '',
      'برجاء مراجعة الطلب وتأكيد التوفر وموعد التوصيل.'
    ].filter(line => line !== '').join('\n');
    const url = `https://wa.me/${state.catalog.settings.whatsapp}?text=${encodeURIComponent(message)}`;
    window.open(url, '_blank', 'noopener');
    showToast('تم تجهيز الطلب وفتح واتساب');
  }

  function showToast(message, success = true) {
    clearTimeout(state.toastTimer);
    els.toastText.textContent = message;
    els.toastIcon.textContent = success ? '✓' : '!';
    els.toastIcon.style.background = success ? 'var(--gold)' : '#d16a5f';
    els.toast.classList.add('is-visible');
    state.toastTimer = setTimeout(() => els.toast.classList.remove('is-visible'), 3000);
  }

  function setupReveals() {
    const items = $$('.reveal:not(.is-visible)');
    if (!('IntersectionObserver' in window)) {
      items.forEach(item => item.classList.add('is-visible'));
      return;
    }
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: .08, rootMargin: '0px 0px -30px' });
    items.forEach(item => observer.observe(item));
  }

  document.addEventListener('click', event => {
    const add = event.target.closest('[data-add]');
    if (add) { event.stopPropagation(); addToCart(add.dataset.add); return; }
    const openProductButton = event.target.closest('[data-open-product]');
    if (openProductButton) { openProduct(openProductButton.dataset.openProduct); return; }
    const category = event.target.closest('[data-category]');
    if (category) { setFilter(category.dataset.category); return; }
    const filter = event.target.closest('[data-filter]');
    if (filter) { setFilter(filter.dataset.filter); return; }
    if (event.target.closest('[data-show-all]')) { setFilter('all'); return; }
    if (event.target.closest('[data-filter-new]')) {
      state.filter = 'all';
      $('#new').scrollIntoView({ behavior: 'smooth' });
      return;
    }
    const searchProduct = event.target.closest('[data-search-product]');
    if (searchProduct) { closeUI(false); setTimeout(() => openProduct(searchProduct.dataset.searchProduct), 50); return; }
    const plus = event.target.closest('[data-cart-plus]');
    if (plus) { updateCart(plus.dataset.cartPlus, 1); return; }
    const minus = event.target.closest('[data-cart-minus]');
    if (minus) { updateCart(minus.dataset.cartMinus, -1); return; }
    const remove = event.target.closest('[data-remove]');
    if (remove) { removeFromCart(remove.dataset.remove); return; }
    if (event.target.closest('[data-modal-plus]')) { updateModalQty(1); return; }
    if (event.target.closest('[data-modal-minus]')) { updateModalQty(-1); return; }
    if (event.target.closest('[data-modal-add]')) { addToCart(state.modalProduct.id, state.modalQty); closeUI(); setTimeout(() => openUI(els.cartDrawer), 80); return; }
    if (event.target.closest('[data-close]')) { closeUI(); return; }
    if (event.target.closest('[data-shipping-info]')) { showToast(state.catalog?.settings?.shippingNote || 'الشحن متاح لكل المحافظات'); return; }
    if (event.target.closest('[data-contact]')) { window.open($('#footerWhatsapp').href, '_blank', 'noopener'); }
  });

  document.addEventListener('keydown', event => {
    if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('[data-category], [data-open-product]')) {
      event.preventDefault();
      event.target.click();
    }
    if (event.key === 'Escape') closeUI();
  });

  $('#menuToggle').addEventListener('click', () => {
    openUI(els.mobileMenu);
    $('#menuToggle').setAttribute('aria-expanded', 'true');
  });
  $('#cartOpen').addEventListener('click', () => openUI(els.cartDrawer));
  $('#searchOpen').addEventListener('click', () => openUI(els.searchPanel));
  $('#checkoutOpen').addEventListener('click', openCheckout);
  els.overlay.addEventListener('click', () => closeUI());
  els.searchInput.addEventListener('input', event => renderSearch(event.target.value));
  els.governorate.addEventListener('change', updateCheckoutSummary);
  els.checkoutForm.addEventListener('submit', submitCheckout);
  $$('.mobile-menu a[href^="#"]').forEach(link => link.addEventListener('click', () => closeUI()));

  let ticking = false;
  window.addEventListener('scroll', () => {
    if (!ticking) {
      requestAnimationFrame(() => {
        els.header.classList.toggle('is-scrolled', scrollY > 35);
        ticking = false;
      });
      ticking = true;
    }
  }, { passive: true });

  loadStore();
  setupReveals();
})();
