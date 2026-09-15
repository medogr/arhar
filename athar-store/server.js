const express = require('express');
const multer = require('multer');
const ExcelJS = require('exceljs');
const crypto = require('crypto');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'athar-demo-2026';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const WORKBOOK_PATH = path.join(DATA_DIR, 'store.xlsx');
const UPLOADS_DIR = path.join(PUBLIC_DIR, 'uploads');
const BACKUPS_DIR = path.join(DATA_DIR, 'backups');

for (const dir of [DATA_DIR, UPLOADS_DIR, BACKUPS_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob: https:; font-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'");
  next();
});

const sessions = new Map();
const loginAttempts = new Map();
const SESSION_AGE_MS = 8 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 7;

setInterval(() => {
  const now = Date.now();
  for (const [token, session] of sessions) if (session.expiresAt < now) sessions.delete(token);
  for (const [ip, attempt] of loginAttempts) if (attempt.resetAt < now) loginAttempts.delete(ip);
}, 30 * 60 * 1000).unref();

function parseCookies(header = '') {
  return header.split(';').reduce((acc, part) => {
    const index = part.indexOf('=');
    if (index > -1) {
      const key = part.slice(0, index).trim();
      const value = part.slice(index + 1).trim();
      try { acc[key] = decodeURIComponent(value); } catch { acc[key] = value; }
    }
    return acc;
  }, {});
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function requireAdmin(req, res, next) {
  const token = parseCookies(req.headers.cookie).athar_admin;
  const session = token && sessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    if (token) sessions.delete(token);
    return res.status(401).json({ error: 'يرجى تسجيل الدخول إلى لوحة الإدارة.' });
  }
  session.expiresAt = Date.now() + SESSION_AGE_MS;
  next();
}

function cellValue(cell) {
  const value = cell ? cell.value : '';
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) return value.richText.map(p => p.text).join('');
    if (Object.prototype.hasOwnProperty.call(value, 'result')) return value.result ?? '';
    if (Object.prototype.hasOwnProperty.call(value, 'text')) return value.text ?? '';
    if (Object.prototype.hasOwnProperty.call(value, 'hyperlink')) return value.text || value.hyperlink || '';
  }
  return value;
}

function sheetRows(workbook, sheetName) {
  const sheet = workbook.getWorksheet(sheetName);
  if (!sheet || sheet.rowCount < 1) return [];
  const headers = [];
  sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => {
    headers[col] = String(cellValue(cell)).trim();
  });
  const rows = [];
  for (let r = 2; r <= sheet.rowCount; r += 1) {
    const row = sheet.getRow(r);
    const out = {};
    let nonEmpty = false;
    for (let c = 1; c < headers.length; c += 1) {
      if (!headers[c]) continue;
      const value = cellValue(row.getCell(c));
      if (String(value ?? '').trim() !== '') nonEmpty = true;
      out[headers[c]] = value;
    }
    if (nonEmpty) rows.push(out);
  }
  return rows;
}

function pick(row, keys, fallback = '') {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(row, key) && String(row[key] ?? '').trim() !== '') {
      return row[key];
    }
  }
  return fallback;
}

function isYes(value, defaultValue = false) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return defaultValue;
  return ['نعم', 'yes', 'true', '1', 'y', 'متاح'].includes(normalized);
}

function numberValue(value, fallback = 0) {
  const normalized = String(value ?? '').replace(/,/g, '').replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
  const number = Number(normalized);
  return Number.isFinite(number) ? number : fallback;
}

function imageUrl(filename) {
  const value = String(filename || '').trim();
  if (!value) return '/assets/product-placeholder.svg';
  if (/^(https?:)?\/\//i.test(value) || value.startsWith('/')) return value;
  return `/uploads/${encodeURIComponent(path.basename(value))}`;
}

function splitImages(value) {
  return String(value || '')
    .split(/[,،;\n]+/)
    .map(item => item.trim())
    .filter(Boolean)
    .map(imageUrl);
}

const settingAliases = {
  'اسم المتجر': 'storeName',
  'رقم واتساب': 'whatsapp',
  'رقم واتساب (دولي بدون +)': 'whatsapp',
  'العملة': 'currency',
  'شريط الإعلان': 'announcement',
  'رسالة الشريط العلوي': 'announcement',
  'عنوان الواجهة': 'heroTitle',
  'وصف الواجهة': 'heroSubtitle',
  'صورة الواجهة': 'heroImage',
  'نص زر الواجهة': 'heroButton',
  'عنوان قسم الفئات': 'categoriesTitle',
  'عنوان المنتجات المميزة': 'featuredTitle',
  'عنوان وصل حديثًا': 'newTitle',
  'عنوان آراء العملاء': 'reviewsTitle',
  'عنوان من نحن': 'aboutTitle',
  'نص من نحن': 'aboutText',
  'إنستجرام': 'instagram',
  'رابط إنستجرام': 'instagram',
  'فيسبوك': 'facebook',
  'بريد إلكتروني': 'email',
  'ملاحظة الشحن': 'shippingNote',
  'رسالة أسفل الصفحة': 'footerNote',
  'اللون الأساسي (اختياري)': 'primaryColor',
  'اللون المساعد (اختياري)': 'accentColor'
};

function parseWorkbook(workbook) {
  const productRows = sheetRows(workbook, 'المنتجات');
  const categoryRows = sheetRows(workbook, 'الفئات');
  const settingsRows = sheetRows(workbook, 'إعدادات المتجر');
  const shippingRows = sheetRows(workbook, 'الشحن');
  const reviewRows = sheetRows(workbook, 'آراء العملاء');

  if (!productRows.length) throw new Error('شيت "المنتجات" غير موجود أو لا يحتوي على منتجات.');

  const defaults = {
    storeName: 'أثر',
    whatsapp: '201030263241',
    currency: 'ج.م',
    announcement: 'شحن لكل محافظات مصر • تأكيد الطلب عبر واتساب',
    heroTitle: 'تفاصيل صغيرة، تصنع أثرًا كبيرًا',
    heroSubtitle: 'منتجات منتقاة لترافق أيامك وتترك لمسة لا تُنسى.',
    heroImage: '/uploads/hero-athar.jpg',
    heroButton: 'اكتشف المجموعة',
    categoriesTitle: 'اختار اللي يناسب يومك',
    featuredTitle: 'اختيارات صنعت لتبقى',
    newTitle: 'وصل حديثًا',
    reviewsTitle: 'كلام ترك أثرًا',
    aboutTitle: 'كل تفصيلة لها معنى',
    aboutText: 'في أثر نختار كل قطعة بهدوء واهتمام، علشان توصلك حاجة بسيطة لكن تفضل معاك.',
    instagram: '', facebook: '', email: '',
    shippingNote: 'تكلفة الشحن تُحسب حسب المحافظة ويتم تأكيد الطلب عبر واتساب.',
    footerNote: 'مصنوع بحب ليترك أثرًا جميلًا.',
    primaryColor: '#111111', accentColor: '#c9a452'
  };

  for (const row of settingsRows) {
    const key = String(pick(row, ['الإعداد', 'المفتاح'])).trim();
    const value = pick(row, ['القيمة', 'Value']);
    const mapped = settingAliases[key];
    if (mapped && String(value ?? '').trim() !== '') defaults[mapped] = String(value).trim();
  }
  defaults.whatsapp = defaults.whatsapp.replace(/\D/g, '');
  defaults.heroImage = imageUrl(defaults.heroImage);

  const products = productRows.map((row, index) => {
    const id = String(pick(row, ['معرّف المنتج', 'معرف المنتج', 'product_id'], `product-${index + 1}`)).trim();
    const mainImage = imageUrl(pick(row, ['الصورة الرئيسية', 'اسم ملف الصورة الرئيسية', 'image']));
    const extraImages = splitImages(pick(row, ['صور إضافية', 'أسماء الصور الإضافية (افصل بفاصلة)', 'gallery']));
    return {
      id,
      name: String(pick(row, ['اسم المنتج', 'name'], 'منتج بدون اسم')).trim(),
      category: String(pick(row, ['الفئة', 'category'], 'منتجات')).trim(),
      price: numberValue(pick(row, ['السعر', 'price'])),
      oldPrice: numberValue(pick(row, ['السعر قبل الخصم', 'السعر قبل الخصم (اختياري)', 'old_price']), 0),
      shortDescription: String(pick(row, ['وصف قصير', 'short_description'])).trim(),
      description: String(pick(row, ['الوصف الكامل', 'description'])).trim(),
      image: mainImage,
      images: [mainImage, ...extraImages.filter(img => img !== mainImage)],
      available: isYes(pick(row, ['متوفر', 'متوفر؟', 'available']), true),
      featured: isYes(pick(row, ['مميز', 'منتج مميز؟', 'featured']), false),
      isNew: isYes(pick(row, ['وصل حديثًا', 'وصل حديثاً', 'وصل حديثًا؟', 'new']), false),
      order: numberValue(pick(row, ['الترتيب', 'order']), index + 1),
      material: String(pick(row, ['الخامة', 'material'])).trim(),
      size: String(pick(row, ['المقاس', 'size'])).trim()
    };
  }).filter(product => product.available && product.id && product.name)
    .sort((a, b) => a.order - b.order);

  let categories = categoryRows.map((row, index) => ({
    id: String(pick(row, ['معرّف الفئة', 'معرف الفئة', 'category_id'], `category-${index + 1}`)).trim(),
    name: String(pick(row, ['اسم الفئة', 'الفئة', 'name'])).trim(),
    image: imageUrl(pick(row, ['صورة الفئة', 'اسم ملف صورة الفئة', 'image'])),
    description: String(pick(row, ['وصف قصير', 'description'])).trim(),
    order: numberValue(pick(row, ['الترتيب', 'order']), index + 1)
  })).filter(item => item.name).sort((a, b) => a.order - b.order);

  if (!categories.length) {
    categories = [...new Set(products.map(p => p.category))].map((name, index) => ({
      id: `category-${index + 1}`, name, image: products.find(p => p.category === name)?.image, description: '', order: index + 1
    }));
  }

  const shipping = shippingRows.map((row, index) => ({
    governorate: String(pick(row, ['المحافظة', 'governorate'])).trim(),
    cost: numberValue(pick(row, ['التكلفة', 'السعر', 'cost'])),
    available: isYes(pick(row, ['متاح', 'available']), true),
    order: index + 1
  })).filter(item => item.governorate && item.available);

  const reviews = reviewRows.map((row, index) => ({
    name: String(pick(row, ['الاسم', 'name'], 'عميل أثر')).trim(),
    text: String(pick(row, ['الرأي', 'النص', 'review'])).trim(),
    rating: Math.min(5, Math.max(1, numberValue(pick(row, ['التقييم', 'rating']), 5))),
    order: numberValue(pick(row, ['الترتيب', 'order']), index + 1),
    visible: isYes(pick(row, ['ظاهر', 'visible']), true)
  })).filter(item => item.text && item.visible).sort((a, b) => a.order - b.order);

  return { settings: defaults, products, categories, shipping, reviews };
}

let workbookCache = { mtimeMs: 0, data: null };

async function loadCatalog() {
  const stats = await fsp.stat(WORKBOOK_PATH);
  if (workbookCache.data && workbookCache.mtimeMs === stats.mtimeMs) return workbookCache.data;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(WORKBOOK_PATH);
  const data = parseWorkbook(workbook);
  data.meta = {
    updatedAt: stats.mtime.toISOString(),
    productCount: data.products.length,
    categoryCount: data.categories.length
  };
  workbookCache = { mtimeMs: stats.mtimeMs, data };
  return data;
}

app.get('/api/store', async (req, res) => {
  try {
    const data = await loadCatalog();
    res.setHeader('Cache-Control', 'no-store');
    res.json(data);
  } catch (error) {
    console.error('Catalog error:', error);
    res.status(500).json({ error: 'تعذر قراءة بيانات المتجر من ملف Excel.', details: error.message });
  }
});

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'Athar Store', time: new Date().toISOString() }));

app.post('/api/admin/login', (req, res) => {
  const password = req.body?.password || '';
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const attempt = loginAttempts.get(ip);
  if (attempt && attempt.count >= LOGIN_MAX_ATTEMPTS && attempt.resetAt > now) {
    const minutes = Math.max(1, Math.ceil((attempt.resetAt - now) / 60000));
    return res.status(429).json({ error: `محاولات دخول كثيرة. جرّب مرة أخرى بعد ${minutes} دقيقة.` });
  }
  if (!safeEqual(password, ADMIN_PASSWORD)) {
    const current = attempt && attempt.resetAt > now ? attempt : { count: 0, resetAt: now + LOGIN_WINDOW_MS };
    current.count += 1;
    loginAttempts.set(ip, current);
    return res.status(401).json({ error: 'كلمة المرور غير صحيحة.' });
  }
  loginAttempts.delete(ip);
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { expiresAt: Date.now() + SESSION_AGE_MS });
  res.setHeader('Set-Cookie', `athar_admin=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_AGE_MS / 1000}${IS_PRODUCTION ? '; Secure' : ''}`);
  res.json({ ok: true });
});

app.post('/api/admin/logout', requireAdmin, (req, res) => {
  const token = parseCookies(req.headers.cookie).athar_admin;
  if (token) sessions.delete(token);
  res.setHeader('Set-Cookie', 'athar_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/admin/status', requireAdmin, async (req, res) => {
  try {
    const catalog = await loadCatalog();
    const files = (await fsp.readdir(UPLOADS_DIR, { withFileTypes: true }))
      .filter(item => item.isFile() && /\.(png|jpe?g|webp|gif)$/i.test(item.name))
      .map(item => item.name)
      .sort((a, b) => a.localeCompare(b, 'ar'));
    const stats = await fsp.stat(WORKBOOK_PATH);
    res.json({
      ok: true,
      productCount: catalog.products.length,
      categoryCount: catalog.categories.length,
      imageCount: files.length,
      workbookUpdatedAt: stats.mtime.toISOString(),
      images: files
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const excelUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, callback) => {
    callback(null, /\.(xlsx|xlsm)$/i.test(file.originalname));
  }
});

app.post('/api/admin/upload-excel', requireAdmin, excelUpload.single('excel'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'اختر ملف Excel بصيغة XLSX.' });
  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(req.file.buffer);
    const parsed = parseWorkbook(workbook);
    if (!parsed.products.length) throw new Error('لا توجد منتجات متاحة في الملف.');

    if (fs.existsSync(WORKBOOK_PATH)) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      await fsp.copyFile(WORKBOOK_PATH, path.join(BACKUPS_DIR, `store-${stamp}.xlsx`));
      const backups = (await fsp.readdir(BACKUPS_DIR)).filter(f => f.endsWith('.xlsx')).sort().reverse();
      await Promise.all(backups.slice(5).map(file => fsp.unlink(path.join(BACKUPS_DIR, file))));
    }
    const tempPath = `${WORKBOOK_PATH}.tmp`;
    await fsp.writeFile(tempPath, req.file.buffer);
    await fsp.rename(tempPath, WORKBOOK_PATH);
    workbookCache = { mtimeMs: 0, data: null };
    res.json({ ok: true, message: 'تم تحديث بيانات المتجر بنجاح.', productCount: parsed.products.length });
  } catch (error) {
    console.error('Excel upload error:', error);
    res.status(400).json({ error: `الملف غير صالح: ${error.message}` });
  }
});

function cleanOriginalName(name) {
  let decoded = name;
  try {
    const maybe = Buffer.from(name, 'latin1').toString('utf8');
    if (!maybe.includes('�')) decoded = maybe;
  } catch {}
  const ext = path.extname(decoded).toLowerCase();
  const base = path.basename(decoded, path.extname(decoded))
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90) || `image-${Date.now()}`;
  return `${base}${ext}`;
}

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024, files: 60 },
  fileFilter: (req, file, callback) => {
    const allowed = /\.(png|jpe?g|webp|gif)$/i.test(file.originalname) && /^image\//i.test(file.mimetype);
    callback(null, allowed);
  }
});

app.post('/api/admin/upload-images', requireAdmin, imageUpload.array('images', 60), async (req, res) => {
  if (!req.files?.length) return res.status(400).json({ error: 'اختر صورة واحدة على الأقل بصيغة JPG أو PNG أو WEBP.' });
  try {
    const saved = [];
    for (const file of req.files) {
      const filename = cleanOriginalName(file.originalname);
      await fsp.writeFile(path.join(UPLOADS_DIR, filename), file.buffer);
      saved.push(filename);
    }
    res.json({ ok: true, message: `تم رفع ${saved.length} صورة.`, files: saved });
  } catch (error) {
    res.status(500).json({ error: `تعذر حفظ الصور: ${error.message}` });
  }
});

app.delete('/api/admin/images/:filename', requireAdmin, async (req, res) => {
  const filename = path.basename(req.params.filename);
  if (!/\.(png|jpe?g|webp|gif)$/i.test(filename)) return res.status(400).json({ error: 'اسم ملف غير صالح.' });
  try {
    await fsp.unlink(path.join(UPLOADS_DIR, filename));
    res.json({ ok: true });
  } catch (error) {
    if (error.code === 'ENOENT') return res.status(404).json({ error: 'الصورة غير موجودة.' });
    res.status(500).json({ error: 'تعذر حذف الصورة.' });
  }
});

app.get('/api/admin/download-excel', requireAdmin, (req, res) => {
  res.download(WORKBOOK_PATH, 'athar-store.xlsx');
});

app.get('/admin', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin.html')));
app.use(express.static(PUBLIC_DIR, { maxAge: IS_PRODUCTION ? '1h' : 0, extensions: ['html'] }));
app.get('*', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

app.use((error, req, res, next) => {
  console.error(error);
  if (error instanceof multer.MulterError) {
    const message = error.code === 'LIMIT_FILE_SIZE' ? 'حجم الملف أكبر من 12 ميجابايت.' : 'حدث خطأ أثناء رفع الملف.';
    return res.status(400).json({ error: message });
  }
  res.status(500).json({ error: 'حدث خطأ غير متوقع.' });
});

app.listen(PORT, HOST, () => {
  console.log(`Athar Store running on http://${HOST}:${PORT}`);
  if (!process.env.ADMIN_PASSWORD) {
    console.log('Admin preview password: athar-demo-2026 (change ADMIN_PASSWORD before production)');
  }
});
