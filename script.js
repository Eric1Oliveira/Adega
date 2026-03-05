// ============================================
// ADEGA MANAGER - Application Core
// ============================================

// Supabase Configuration
const SUPABASE_URL = 'https://aqxszqvirxnqnugpteci.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFxeHN6cXZpcnhucW51Z3B0ZWNpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI1MDEwNjcsImV4cCI6MjA4ODA3NzA2N30.ZIv_GbmpiFQdyZghOeprac4QjBOjCpBP7IQp5iPmwVI';

let supabaseClient;

// Authentication State
let currentUser = null; // { username, role: 'admin' | 'user' }

// Application State
let products = [];
let suppliers = [];
let sales = [];
let stockEntries = [];
let expenses = [];
let stockHistory = [];
let cart = [];
let currentPage = 'dashboard';

// Shift System
let shiftConfig = {
  shift1_name: 'Manhã',
  shift1_start: '06:00',
  shift1_end: '14:00',
  shift2_name: 'Noite',
  shift2_start: '14:00',
  shift2_end: '23:59'
};
let shiftUpdateInterval = null;
let reportShiftFilter = 'all'; // 'all' | 'shift1' | 'shift2'

// Default Config
const defaultConfig = {
  business_name: 'Adega Manager',
  currency_symbol: 'R$',
  primary_color: '#1c202a',
  secondary_color: '#f6f7f9',
  text_color: '#1c202a',
  accent_color: '#d49b28',
  surface_color: '#ffffff'
};

// ============================================
// AUTHENTICATION SYSTEM
// ============================================

const _tableAvailable = {}; // cache: table name -> true/false

async function isTableAvailable(table) {
  if (!supabaseClient) return false;
  if (table in _tableAvailable) return _tableAvailable[table];
  try {
    const { error } = await supabaseClient.from(table).select('id').limit(1);
    _tableAvailable[table] = !error;
  } catch (e) {
    _tableAvailable[table] = false;
  }
  return _tableAvailable[table];
}

async function initUsersTable() {
  if (!supabaseClient) return;
  if (!(await isTableAvailable('app_users'))) return;
  try {
    const { data } = await supabaseClient.from('app_users').select('id').limit(1);
    if (!data || data.length === 0) {
      await supabaseClient.from('app_users').upsert([
        { username: 'admin', password: 'admin', role: 'admin', display_name: 'Administrador' },
        { username: 'user', password: 'user', role: 'user', display_name: 'Funcionário' }
      ], { onConflict: 'username' });
    }
  } catch (e) {
    // silently fall back to local auth
  }
}

// Default local users (fallback when Supabase is unavailable)
const LOCAL_USERS = [
  { username: 'admin', password: 'admin', role: 'admin', display_name: 'Administrador' },
  { username: 'user', password: 'user', role: 'user', display_name: 'Funcionário' }
];

async function handleLogin(e) {
  e.preventDefault();
  const username = document.getElementById('login-username').value.trim().toLowerCase();
  const password = document.getElementById('login-password').value;
  const errorEl = document.getElementById('login-error');
  errorEl.classList.add('hidden');

  let authenticatedUser = null;

  // Try Supabase first (only if app_users table exists)
  if (supabaseClient && _tableAvailable['app_users']) {
    try {
      const { data, error } = await supabaseClient
        .from('app_users')
        .select('*')
        .eq('username', username)
        .eq('password', password)
        .single();
      if (data && !error) {
        authenticatedUser = { username: data.username, role: data.role, display_name: data.display_name };
      }
    } catch (e) {
      console.log('Supabase auth failed, trying local fallback');
    }
  }

  // Fallback to local users
  if (!authenticatedUser) {
    const localUser = LOCAL_USERS.find(u => u.username === username && u.password === password);
    if (localUser) {
      authenticatedUser = { username: localUser.username, role: localUser.role, display_name: localUser.display_name };
    }
  }

  if (authenticatedUser) {
    currentUser = authenticatedUser;
    localStorage.setItem('adega_current_user', JSON.stringify(currentUser));
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    applyRoleRestrictions();
    await initApp();
  } else {
    errorEl.classList.remove('hidden');
    document.getElementById('login-password').value = '';
  }
}

function handleLogout() {
  currentUser = null;
  localStorage.removeItem('adega_current_user');
  document.getElementById('app').classList.add('hidden');
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('login-form').reset();
  document.getElementById('login-error').classList.add('hidden');
}

function isAdmin() {
  return currentUser && currentUser.role === 'admin';
}

function applyRoleRestrictions() {
  if (!currentUser) return;

  // Update user display
  const nameEl = document.getElementById('user-display-name');
  const roleEl = document.getElementById('user-display-role');
  if (nameEl) nameEl.textContent = currentUser.display_name || currentUser.username;
  if (roleEl) roleEl.textContent = currentUser.role === 'admin' ? 'Administrador' : 'Funcionário';

  // Show/hide sidebar items based on role
  document.querySelectorAll('[data-role]').forEach(el => {
    const requiredRole = el.getAttribute('data-role');
    if (requiredRole === 'admin' && !isAdmin()) {
      el.classList.add('hidden');
    } else {
      el.classList.remove('hidden');
    }
  });

  // Hide price-related elements for user role
  document.querySelectorAll('.admin-only').forEach(el => {
    el.style.display = isAdmin() ? '' : 'none';
  });

  // Re-render content to apply price visibility
  if (typeof renderProducts === 'function') renderProducts();
  if (typeof renderPosProducts === 'function') renderPosProducts();
}

// ============================================
// APPLICATION INIT
// ============================================

// Initialize Application
async function init() {
  try {
    // Initialize Supabase
    if (window.supabase) {
      supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }

    // Initialize users table
    await initUsersTable();

    // Check for saved session
    const savedUser = localStorage.getItem('adega_current_user');
    if (savedUser) {
      try {
        currentUser = JSON.parse(savedUser);
        document.getElementById('login-screen').classList.add('hidden');
        document.getElementById('app').classList.remove('hidden');
        applyRoleRestrictions();
        await initApp();
      } catch (e) {
        localStorage.removeItem('adega_current_user');
      }
    }
  } catch (error) {
    console.error('Pre-init error:', error);
  }
}

async function initApp() {
  try {
    
    // Initialize Element SDK
    if (window.elementSdk) {
      window.elementSdk.init({
        defaultConfig,
        onConfigChange: async (config) => {
          const businessName = config.business_name || defaultConfig.business_name;
          const el = document.getElementById('business-name');
          if (el) el.textContent = businessName;
        },
        mapToCapabilities: (config) => ({
          recolorables: [
            { 
              get: () => config.primary_color || defaultConfig.primary_color, 
              set: (v) => { config.primary_color = v; if (window.elementSdk) window.elementSdk.setConfig({ primary_color: v }); } 
            },
            { 
              get: () => config.secondary_color || defaultConfig.secondary_color, 
              set: (v) => { config.secondary_color = v; if (window.elementSdk) window.elementSdk.setConfig({ secondary_color: v }); } 
            },
            { 
              get: () => config.text_color || defaultConfig.text_color, 
              set: (v) => { config.text_color = v; if (window.elementSdk) window.elementSdk.setConfig({ text_color: v }); } 
            },
            { 
              get: () => config.accent_color || defaultConfig.accent_color, 
              set: (v) => { config.accent_color = v; if (window.elementSdk) window.elementSdk.setConfig({ accent_color: v }); } 
            },
            { 
              get: () => config.surface_color || defaultConfig.surface_color, 
              set: (v) => { config.surface_color = v; if (window.elementSdk) window.elementSdk.setConfig({ surface_color: v }); } 
            }
          ],
          borderables: [],
          fontEditable: undefined,
          fontSizeable: undefined
        }),
        mapToEditPanelValues: (config) => new Map([
          ['business_name', config.business_name || defaultConfig.business_name],
          ['currency_symbol', config.currency_symbol || defaultConfig.currency_symbol]
        ])
      });
    }
    
    // Initialize database and load data
    await initializeDatabase();
    await loadAllData();
    
    // Setup UI
    await loadShiftConfig();
    setupSalesChart();
    updateDashboard();
    updateAlerts();
    updateReportShiftLabels();
    navigateTo(isAdmin() ? 'dashboard' : 'products');
    
    // Check dark mode preference
    if (localStorage.getItem('darkMode') === 'true') {
      document.documentElement.classList.add('dark');
      updateThemeUI();
    }
    
  } catch (error) {
    console.error('Initialization error:', error);
    showToast('Erro ao conectar com o banco de dados. Verifique sua conexão.', 'error');
    // Still try to render whatever we have (empty state)
    renderProducts();
    renderSuppliers();
    updateProductSelects();
    updateSupplierSelects();
    renderPosProducts();
    setupSalesChart();
    updateDashboard();
    navigateTo(isAdmin() ? 'dashboard' : 'products');
  }
}

// Navigation
const ADMIN_ONLY_PAGES = ['dashboard', 'financial', 'reports', 'settings', 'suppliers'];

function navigateTo(page) {
  // Enforce role restriction
  if (!isAdmin() && ADMIN_ONLY_PAGES.includes(page)) {
    showToast('Acesso restrito ao administrador', 'warning');
    return;
  }
  currentPage = page;
  document.querySelectorAll('.page-content').forEach(p => p.classList.add('hidden'));
  const pageEl = document.getElementById(`page-${page}`);
  if (pageEl) pageEl.classList.remove('hidden');
  
  document.querySelectorAll('[data-nav]').forEach(btn => {
    btn.classList.remove('active-nav');
  });
  const activeBtn = document.querySelector(`[data-nav="${page}"]`);
  if (activeBtn) {
    activeBtn.classList.add('active-nav');
  }
  
  // Close sidebar on mobile
  if (window.innerWidth < 1024) {
    const sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.classList.add('-translate-x-full');
  }
  
  // Refresh page-specific content
  if (page === 'dashboard') updateDashboard();
  if (page === 'alerts') updateAlerts();
  if (page === 'financial') updateFinancials();
  if (page === 'reports') refreshReports();
  if (page === 'sales') { renderQuoteHistory(); updateShiftIndicator(); }
  if (page === 'quotes') renderQuoteHistory();
  if (page === 'settings') refreshSettingsPage();
}

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  if (sidebar) sidebar.classList.toggle('-translate-x-full');
}

// Dark Mode
function toggleDarkMode() {
  document.documentElement.classList.toggle('dark');
  const isDark = document.documentElement.classList.contains('dark');
  localStorage.setItem('darkMode', isDark);
  updateThemeUI();
  // Refresh report charts with new theme colors
  if (currentPage === 'reports') refreshReports();
}

function updateThemeUI() {
  const isDark = document.documentElement.classList.contains('dark');
  const themeText = document.getElementById('theme-text');
  const themeIcon = document.getElementById('theme-icon');
  
  if (themeText) themeText.textContent = isDark ? 'Modo Claro' : 'Modo Escuro';
  if (themeIcon) {
    themeIcon.innerHTML = isDark 
      ? '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"/>'
      : '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"/>';
  }
}

// Initialize Database Tables
async function initializeDatabase() {
  if (!supabaseClient) {
    showToast('Erro: conexão com banco de dados não disponível', 'error');
    return;
  }
  try {
    const { error } = await supabaseClient.from('products').select('id').limit(1);
    if (error && (error.code === '42P01' || error.message.includes('relation'))) {
      showToast('Tabelas não encontradas no Supabase. Crie as tabelas necessárias.', 'error');
    }
  } catch (e) {
    console.error('Database init check failed:', e);
    showToast('Erro ao verificar banco de dados', 'error');
  }
}

// ============================================
// DATABASE LAYER - Supabase is the ONLY source of truth
// No localStorage for data. Everything comes from the DB.
// ============================================

// Helper: fetch a full table from Supabase
async function dbFetchAll(table, orderBy = 'created_at', ascending = false) {
  if (!supabaseClient) return [];
  const { data, error } = await supabaseClient
    .from(table)
    .select('*')
    .order(orderBy, { ascending });
  if (error) {
    console.error(`DB fetch ${table} error:`, error);
    return [];
  }
  return data || [];
}

// Helper: insert a row into Supabase - throws on failure
async function dbInsert(table, row) {
  if (!supabaseClient) throw new Error('Sem conexão com o banco de dados');
  const { data, error } = await supabaseClient.from(table).insert(row).select();
  if (error) throw error;
  return data;
}

// Helper: update a row in Supabase - throws on failure
async function dbUpdate(table, id, updates) {
  if (!supabaseClient) throw new Error('Sem conexão com o banco de dados');
  const { data, error } = await supabaseClient.from(table).update(updates).eq('id', id).select();
  if (error) throw error;
  return data;
}

// Helper: delete a row from Supabase - throws on failure
async function dbDelete(table, id) {
  if (!supabaseClient) throw new Error('Sem conexão com o banco de dados');
  const { error } = await supabaseClient.from(table).delete().eq('id', id);
  if (error) throw error;
}

// Reload ALL data from Supabase and refresh the UI
async function loadAllData() {
  try {
    const [p, s, sa, se, e, sh] = await Promise.all([
      dbFetchAll('products', 'name', true),
      dbFetchAll('suppliers', 'name', true),
      dbFetchAll('sales', 'created_at', false),
      dbFetchAll('stock_entries', 'created_at', false),
      dbFetchAll('expenses', 'created_at', false),
      isTableAvailable('stock_history') ? dbFetchAll('stock_history', 'created_at', false) : Promise.resolve([])
    ]);

    products = p;
    suppliers = s;
    sales = sa;
    stockEntries = se;
    expenses = e;
    stockHistory = sh;

    console.log(`DB loaded: ${products.length} products, ${suppliers.length} suppliers, ${sales.length} sales, ${stockEntries.length} entries, ${expenses.length} expenses, ${stockHistory.length} stock history`);
  } catch (err) {
    console.error('Failed to load data from Supabase:', err);
    showToast('Erro ao carregar dados do banco de dados', 'error');
  }

  // Refresh all UI
  renderProducts();
  renderSuppliers();
  updateProductSelects();
  updateSupplierSelects();
  renderPosProducts();
  renderRecentEntries();
}
// Toast Notifications
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  
  const toast = document.createElement('div');
  const bgColor = type === 'success' ? 'bg-green-500' : type === 'error' ? 'bg-red-500' : type === 'warning' ? 'bg-amber-500' : 'bg-blue-500';
  toast.className = `${bgColor} text-white px-6 py-3 rounded-xl shadow-lg animate-slide-in flex items-center gap-2`;
  
  const icons = {
    'success': '<svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>',
    'error': '<svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>',
    'warning': '<svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>',
    'info': '<svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>'
  };
  toast.innerHTML = `${icons[type] || icons['info']} <span>${message}</span>`;
  
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// Product Functions
function openProductModal(product = null) {
  document.getElementById('product-modal').classList.remove('hidden');
  document.getElementById('product-modal-title').textContent = product ? 'Editar Produto' : 'Novo Produto';
  document.getElementById('product-form').reset();
  
  if (product) {
    document.getElementById('product-id').value = product.id;
    document.getElementById('product-name').value = product.name || '';
    document.getElementById('product-category').value = product.category || '';
    document.getElementById('product-brand').value = product.brand || '';
    document.getElementById('product-code').value = product.code || '';
    document.getElementById('product-barcode').value = product.barcode || '';
    document.getElementById('product-volume').value = product.volume || '';
    document.getElementById('product-alcohol').value = product.alcohol || '';
    document.getElementById('product-cost').value = product.cost || '';
    document.getElementById('product-price').value = product.price || '';
    document.getElementById('product-stock').value = product.stock || 0;
    document.getElementById('product-min-stock').value = product.min_stock || 5;
    document.getElementById('product-supplier').value = product.supplier_id || '';
    document.getElementById('product-location').value = product.location || '';
    calculateMargin();
  }
  
  updateSupplierSelects();
}

function closeProductModal() {
  document.getElementById('product-modal').classList.add('hidden');
}

async function saveProduct(e) {
  e.preventDefault();
  
  const productData = {
    name: document.getElementById('product-name').value,
    category: document.getElementById('product-category').value,
    brand: document.getElementById('product-brand').value || null,
    code: document.getElementById('product-code').value || null,
    barcode: document.getElementById('product-barcode').value || null,
    volume: parseInt(document.getElementById('product-volume').value) || null,
    alcohol: parseFloat(document.getElementById('product-alcohol').value) || null,
    cost: parseFloat(document.getElementById('product-cost').value),
    price: parseFloat(document.getElementById('product-price').value),
    stock: parseInt(document.getElementById('product-stock').value) || 0,
    min_stock: parseInt(document.getElementById('product-min-stock').value) || 5,
    supplier_id: document.getElementById('product-supplier').value || null,
    location: document.getElementById('product-location').value || null,
    updated_at: new Date().toISOString()
  };
  
  const existingId = document.getElementById('product-id').value;
  
  try {
    if (existingId) {
      await dbUpdate('products', existingId, productData);
    } else {
      productData.id = crypto.randomUUID();
      productData.created_at = new Date().toISOString();
      await dbInsert('products', productData);
    }
    
    // Reload from DB to ensure consistency
    await loadAllData();
    updateDashboard();
    updateAlerts();
    closeProductModal();
    showToast(existingId ? 'Produto atualizado!' : 'Produto cadastrado!');
  } catch (err) {
    console.error('Erro ao salvar produto:', err);
    showToast('Erro ao salvar produto no banco de dados: ' + (err.message || err), 'error');
  }
}

async function deleteProduct(id) {
  const confirmDiv = document.createElement('div');
  confirmDiv.className = 'fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4';
  confirmDiv.innerHTML = `
    <div class="glass-effect rounded-2xl p-6 shadow-2xl max-w-sm w-full animate-slide-in">
      <h3 class="text-lg font-bold text-wine-900 dark:text-white mb-4">Confirmar exclusão?</h3>
      <p class="text-gray-600 dark:text-gray-400 mb-6">Esta ação não pode ser desfeita.</p>
      <div class="flex gap-3">
        <button onclick="this.closest('.fixed').remove()" class="flex-1 py-2 rounded-xl border border-wine-300 dark:border-wine-600 text-wine-700 dark:text-wine-300 font-medium">Cancelar</button>
        <button onclick="confirmDeleteProduct('${id}'); this.closest('.fixed').remove()" class="flex-1 py-2 rounded-xl bg-red-500 text-white font-medium">Excluir</button>
      </div>
    </div>
  `;
  document.body.appendChild(confirmDiv);
}

async function confirmDeleteProduct(id) {
  try {
    await dbDelete('products', id);
    await loadAllData();
    updateDashboard();
    updateAlerts();
    showToast('Produto excluído!');
  } catch (err) {
    console.error('Erro ao excluir produto:', err);
    showToast('Erro ao excluir produto do banco de dados', 'error');
  }
}

function calculateMargin() {
  const cost = parseFloat(document.getElementById('product-cost').value) || 0;
  const price = parseFloat(document.getElementById('product-price').value) || 0;
  const margin = price - cost;
  const marginPercent = cost > 0 ? ((margin / cost) * 100).toFixed(1) : 0;
  
  document.getElementById('margin-display').textContent = `R$ ${margin.toFixed(2)} (${marginPercent}%)`;
  document.getElementById('margin-display').className = margin > 0 
    ? 'text-lg font-bold text-green-600 dark:text-green-400'
    : 'text-lg font-bold text-red-600 dark:text-red-400';
}

function renderProducts() {
  const grid = document.getElementById('products-grid');
  
  if (products.length === 0) {
    grid.innerHTML = '<p class="col-span-full text-center text-gray-500 dark:text-gray-400 py-12">Nenhum produto cadastrado. Clique em "Novo Produto" para começar.</p>';
    return;
  }
  
  const admin = isAdmin();
  grid.innerHTML = products.map(p => {
    const margin = p.price - p.cost;
    const marginPercent = p.cost > 0 ? ((margin / p.cost) * 100).toFixed(0) : 0;
    const stockStatus = p.stock <= 0 ? 'bg-red-100 dark:bg-red-900/50 text-red-600' : 
                       p.stock <= p.min_stock ? 'bg-amber-100 dark:bg-amber-900/50 text-amber-600' : 
                       'bg-green-100 dark:bg-green-900/50 text-green-600';
    const categoryLabel = getCategoryLabel(p.category);
    const displayCode = p.code || p.id.substring(0, 6).toUpperCase();
    
    return `
      <div class="glass-effect rounded-2xl p-4 shadow-lg card-hover">
        <div class="flex items-start justify-between mb-3">
          <div class="flex items-center gap-2">
            <div class="w-10 h-10 rounded-xl bg-wine-900 dark:bg-accent-500/20 flex items-center justify-center text-white dark:text-accent-400">
              ${getCategoryIcon(p.category)}
            </div>
            <span class="text-[10px] font-mono font-semibold text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded select-all" title="Código p/ busca no caixa">#${displayCode}</span>
          </div>
          <span class="${stockStatus} text-xs font-medium px-2 py-1 rounded-full">${p.stock} un</span>
        </div>
        <h4 class="font-bold text-gray-900 dark:text-white mb-1 truncate">${p.name}</h4>
        <p class="text-xs text-gray-500 dark:text-gray-400 mb-3">${categoryLabel}${p.brand ? ' • ' + p.brand : ''}</p>
        
        ${admin ? `
        <div class="flex items-end justify-between mb-3">
          <div>
            <p class="text-xs text-gray-500 dark:text-gray-400">Venda</p>
            <p class="text-lg font-bold text-accent-600 dark:text-accent-400">R$ ${p.price.toFixed(2)}</p>
          </div>
          <div class="text-right">
            <p class="text-xs text-gray-500 dark:text-gray-400">Margem</p>
            <p class="text-sm font-semibold ${margin > 0 ? 'text-green-600' : 'text-red-600'}">${marginPercent}%</p>
          </div>
        </div>` : ''}
        <div class="flex gap-2">
          <button onclick="openQuickStockModal('${p.id}')" class="flex-1 py-2 rounded-lg border border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-400 text-sm font-medium hover:bg-emerald-50 dark:hover:bg-emerald-900/30 flex items-center justify-center gap-1.5 transition-colors">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/></svg>
            Estoque
          </button>
          <button onclick="openProductModal(products.find(p => p.id === '${p.id}'))" class="flex-1 py-2 rounded-lg border border-wine-300 dark:border-wine-600 text-wine-700 dark:text-wine-300 text-sm font-medium hover:bg-wine-50 dark:hover:bg-wine-900/50">
            Editar
          </button>
          ${admin ? `
          <button onclick="deleteProduct('${p.id}')" class="py-2 px-3 rounded-lg border border-red-300 dark:border-red-600 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/50">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
          </button>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

function filterProducts() {
  const search = document.getElementById('product-search').value.toLowerCase();
  const category = document.getElementById('category-filter').value;
  const stockFilter = document.getElementById('stock-filter').value;
  
  // If no filters, just render all
  if (!search && !category && !stockFilter) {
    renderProducts();
    return;
  }
  
  const filtered = products.filter(p => {
    const matchesSearch = !search || 
      p.name.toLowerCase().includes(search) || 
      (p.code && p.code.toLowerCase().includes(search)) ||
      (p.barcode && p.barcode.includes(search)) ||
      (p.brand && p.brand.toLowerCase().includes(search)) ||
      p.id.toLowerCase().includes(search);
    
    const matchesCategory = !category || p.category === category;
    
    let matchesStock = true;
    if (stockFilter === 'low') matchesStock = p.stock > 0 && p.stock <= p.min_stock;
    else if (stockFilter === 'out') matchesStock = p.stock <= 0;
    else if (stockFilter === 'ok') matchesStock = p.stock > p.min_stock;
    
    return matchesSearch && matchesCategory && matchesStock;
  });
  
  const grid = document.getElementById('products-grid');
  if (filtered.length === 0) {
    grid.innerHTML = '<p class="col-span-full text-center text-gray-500 dark:text-gray-400 py-12">Nenhum produto encontrado com os filtros aplicados.</p>';
    return;
  }
  
  // Temporarily replace products for rendering
  const originalProducts = products;
  products = filtered;
  renderProducts();
  products = originalProducts;
}

function clearProductFilters() {
  document.getElementById('product-search').value = '';
  document.getElementById('category-filter').value = '';
  document.getElementById('stock-filter').value = '';
  renderProducts();
}

// Stock adjustment history (Supabase)
function getStockHistory(productId) {
  return stockHistory.filter(h => h.product_id === productId).slice(0, 20);
}

async function addStockHistoryEntry(productId, productName, oldStock, newStock, user) {
  const entry = {
    id: crypto.randomUUID(),
    product_id: productId,
    product_name: productName,
    old_stock: oldStock,
    new_stock: newStock,
    diff: newStock - oldStock,
    user_name: user || 'Sistema',
    created_at: new Date().toISOString()
  };
  try {
    await dbInsert('stock_history', entry);
    stockHistory.unshift(entry);
  } catch (err) {
    console.error('Erro ao salvar histórico de estoque:', err);
    showToast('Erro ao salvar histórico — verifique se a tabela stock_history existe no Supabase', 'error');
  }
}

async function clearStockHistory(productId) {
  try {
    const entries = stockHistory.filter(h => h.product_id === productId);
    for (const e of entries) {
      await dbDelete('stock_history', e.id);
    }
    stockHistory = stockHistory.filter(h => h.product_id !== productId);
    renderQsHistory(productId);
  } catch (err) {
    console.error('Erro ao limpar histórico:', err);
    showToast('Erro ao limpar histórico', 'error');
  }
}

function renderQsHistory(productId) {
  const section = document.getElementById('qs-history-section');
  const list = document.getElementById('qs-history-list');
  const history = getStockHistory(productId);
  
  if (history.length === 0) {
    section.classList.add('hidden');
    return;
  }
  
  section.classList.remove('hidden');
  list.innerHTML = history.map(h => {
    const d = new Date(h.created_at);
    const timeStr = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const isPositive = h.diff > 0;
    const diffColor = h.diff === 0 ? 'text-gray-400' : isPositive ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400';
    const diffIcon = isPositive
      ? '<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 15l7-7 7 7"/></svg>'
      : '<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M19 9l-7 7-7-7"/></svg>';
    const diffBg = isPositive ? 'bg-emerald-500/10' : h.diff < 0 ? 'bg-red-500/10' : 'bg-gray-100 dark:bg-gray-800';
    
    return `
      <div class="flex items-center gap-2.5 px-3 py-2 rounded-xl ${diffBg}">
        <div class="${diffColor} flex-shrink-0">${diffIcon}</div>
        <div class="flex-1 min-w-0">
          <p class="text-[11px] text-gray-500 dark:text-gray-400">${timeStr} · ${h.user_name}</p>
        </div>
        <div class="text-right flex-shrink-0">
          <span class="text-[11px] text-gray-400">${h.old_stock} →</span>
          <span class="text-xs font-bold ${diffColor}">${h.new_stock}</span>
        </div>
        <span class="text-[10px] font-bold ${diffColor} flex-shrink-0">${h.diff > 0 ? '+' : ''}${h.diff}</span>
      </div>`;
  }).join('');
}

let _qsCurrentStock = 0;

function openQuickStockModal(productId) {
  const product = products.find(p => p.id === productId);
  if (!product) return;
  
  _qsCurrentStock = product.stock;
  document.getElementById('qs-product-id').value = product.id;
  document.getElementById('qs-product-name').textContent = product.name;
  document.getElementById('qs-current-stock').textContent = product.stock;
  const input = document.getElementById('qs-new-stock');
  input.value = product.stock;
  document.getElementById('quick-stock-modal').classList.remove('hidden');
  qsUpdatePreview();
  renderQsHistory(product.id);
  setTimeout(() => { input.focus(); input.select(); }, 50);
}

function closeQuickStockModal() {
  document.getElementById('quick-stock-modal').classList.add('hidden');
}

function qsAdjust(delta) {
  const input = document.getElementById('qs-new-stock');
  const val = parseInt(input.value) || 0;
  input.value = Math.max(0, val + delta);
  qsUpdatePreview();
}

function qsUpdatePreview() {
  const val = parseInt(document.getElementById('qs-new-stock').value) || 0;
  const diff = val - _qsCurrentStock;
  const el = document.getElementById('qs-diff');
  if (!el) return;
  if (diff === 0) {
    el.innerHTML = '<span class="text-xs text-gray-400">Sem alteração</span>';
  } else if (diff > 0) {
    el.innerHTML = `<span class="text-xs font-bold text-emerald-600 dark:text-emerald-400">+${diff} unidade${diff !== 1 ? 's' : ''}</span>`;
  } else {
    el.innerHTML = `<span class="text-xs font-bold text-red-500 dark:text-red-400">${diff} unidade${diff !== -1 ? 's' : ''}</span>`;
  }
}

async function saveQuickStock() {
  const productId = document.getElementById('qs-product-id').value;
  const newStock = parseInt(document.getElementById('qs-new-stock').value);
  if (isNaN(newStock) || newStock < 0) {
    showToast('Valor de estoque inválido', 'warning');
    return;
  }
  const product = products.find(p => p.id === productId);
  if (!product) return;
  
  try {
    await dbUpdate('products', productId, { stock: newStock, updated_at: new Date().toISOString() });
    const oldStock = product.stock;
    await addStockHistoryEntry(productId, product.name, oldStock, newStock, currentUser?.display_name || currentUser?.username || 'Sistema');
    product.stock = newStock;
    closeQuickStockModal();
    renderProducts();
    filterProducts();
    updateAlerts();
    updateDashboard();
    const diff = newStock - oldStock;
    showToast(`${product.name}: estoque ${diff >= 0 ? '+' : ''}${diff} → ${newStock} un`, diff >= 0 ? 'success' : 'warning');
  } catch (e) {
    showToast('Erro ao atualizar estoque', 'error');
  }
}

function getCategoryIcon(category) {
  const icons = {
    'vinho-tinto': '<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M8 2l1.5 7H12m0 0h2.5L16 2M12 9c3 0 5 1.5 5 3.5S15 16 12 16s-5-1-5-3.5S9 9 12 9zm0 7v5m-3 0h6"/></svg>',
    'vinho-branco': '<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M8 2l1.5 7H12m0 0h2.5L16 2M12 9c3 0 5 1.5 5 3.5S15 16 12 16s-5-1-5-3.5S9 9 12 9zm0 7v5m-3 0h6"/></svg>',
    'vinho-rose': '<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M8 2l1.5 7H12m0 0h2.5L16 2M12 9c3 0 5 1.5 5 3.5S15 16 12 16s-5-1-5-3.5S9 9 12 9zm0 7v5m-3 0h6"/></svg>',
    'espumante': '<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 2h6l-1 8h-4L9 2zm3 8c2.5 0 4.5 1.5 4.5 3s-2 3-4.5 3-4.5-1.5-4.5-3 2-3 4.5-3zm0 6v5m-2.5 0h5M8 4l-1-2m9 2l1-2"/></svg>',
    'champagne': '<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 2h6l-1 8h-4L9 2zm3 8c2.5 0 4.5 1.5 4.5 3s-2 3-4.5 3-4.5-1.5-4.5-3 2-3 4.5-3zm0 6v5m-2.5 0h5M8 4l-1-2m9 2l1-2"/></svg>',
    'cerveja': '<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M6 3h8v14a2 2 0 01-2 2H8a2 2 0 01-2-2V3zm8 3h2a2 2 0 012 2v4a2 2 0 01-2 2h-2M6 7h8"/></svg>',
    'destilado': '<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 2h6v4l-2 2h-2L9 6V2zm3 6c2 0 3.5 1.5 3.5 3v6a2 2 0 01-2 2h-3a2 2 0 01-2-2v-6c0-1.5 1.5-3 3.5-3z"/></svg>',
    'outros': '<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/></svg>'
  };
  return icons[category] || '<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/></svg>';
}

function getCategoryLabel(category) {
  const labels = {
    'vinho-tinto': 'Vinho Tinto',
    'vinho-branco': 'Vinho Branco',
    'vinho-rose': 'Vinho Rosé',
    'espumante': 'Espumante',
    'champagne': 'Champagne',
    'cerveja': 'Cerveja',
    'destilado': 'Destilado',
    'outros': 'Outros'
  };
  return labels[category] || category;
}

// Supplier Functions
function openSupplierModal(id) {
  const modal = document.getElementById('supplier-modal');
  const form = document.getElementById('supplier-form');
  const title = document.getElementById('supplier-modal-title');
  form.reset();
  document.getElementById('supplier-id').value = '';

  if (id) {
    const s = suppliers.find(sup => sup.id === id);
    if (s) {
      title.textContent = 'Editar Fornecedor';
      document.getElementById('supplier-id').value = s.id;
      document.getElementById('supplier-name').value = s.name || '';
      document.getElementById('supplier-cnpj').value = s.cnpj || '';
      document.getElementById('supplier-phone').value = s.phone || '';
      document.getElementById('supplier-email').value = s.email || '';
      document.getElementById('supplier-contact').value = s.contact || '';
    }
  } else {
    title.textContent = 'Novo Fornecedor';
  }

  modal.classList.remove('hidden');
}

function closeSupplierModal() {
  document.getElementById('supplier-modal').classList.add('hidden');
}

async function saveSupplier(e) {
  e.preventDefault();
  
  const supplierData = {
    name: document.getElementById('supplier-name').value.trim(),
    cnpj: document.getElementById('supplier-cnpj').value.trim() || null,
    phone: document.getElementById('supplier-phone').value.trim() || null,
    email: document.getElementById('supplier-email').value.trim() || null,
    contact: document.getElementById('supplier-contact').value.trim() || null,
    updated_at: new Date().toISOString()
  };
  
  const existingId = document.getElementById('supplier-id').value;
  
  try {
    if (existingId) {
      await dbUpdate('suppliers', existingId, supplierData);
    } else {
      supplierData.id = crypto.randomUUID();
      supplierData.created_at = new Date().toISOString();
      await dbInsert('suppliers', supplierData);
    }
    
    await loadAllData();
    closeSupplierModal();
    showToast(existingId ? 'Fornecedor atualizado!' : 'Fornecedor cadastrado!');
  } catch (err) {
    console.error('Erro ao salvar fornecedor:', err);
    showToast('Erro ao salvar fornecedor no banco de dados: ' + (err.message || err), 'error');
  }
}

async function deleteSupplier(id) {
  const s = suppliers.find(sup => sup.id === id);
  if (!s) return;
  if (!confirm(`Excluir o fornecedor "${s.name}"?\nEssa ação não pode ser desfeita.`)) return;

  try {
    await dbDelete('suppliers', id);
    await loadAllData();
    showToast('Fornecedor excluído!');
  } catch (err) {
    console.error('Erro ao excluir fornecedor:', err);
    showToast('Erro ao excluir fornecedor do banco de dados', 'error');
  }
}

function renderSuppliers() {
  const list = document.getElementById('suppliers-list');
  const searchInput = document.getElementById('supplier-search');
  const countEl = document.getElementById('supplier-count');
  const query = (searchInput ? searchInput.value : '').toLowerCase().trim();

  let filtered = suppliers;
  if (query) {
    filtered = suppliers.filter(s =>
      (s.name || '').toLowerCase().includes(query) ||
      (s.cnpj || '').toLowerCase().includes(query) ||
      (s.phone || '').toLowerCase().includes(query) ||
      (s.email || '').toLowerCase().includes(query) ||
      (s.contact || '').toLowerCase().includes(query)
    );
  }

  if (countEl) {
    countEl.textContent = suppliers.length === 0 ? '' :
      query ? `${filtered.length} de ${suppliers.length} fornecedores` :
      `${suppliers.length} fornecedor${suppliers.length !== 1 ? 'es' : ''} cadastrado${suppliers.length !== 1 ? 's' : ''}`;
  }

  if (filtered.length === 0) {
    list.innerHTML = `<p class="col-span-full text-center text-gray-500 dark:text-gray-400 py-12">${query ? 'Nenhum fornecedor encontrado' : 'Nenhum fornecedor cadastrado'}</p>`;
    return;
  }
  
  list.innerHTML = filtered.map(s => `
    <div class="glass-effect rounded-2xl p-6 shadow-lg card-hover group relative">
      <!-- Actions -->
      <div class="absolute top-4 right-4 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button onclick="openSupplierModal('${s.id}')" title="Editar" class="w-8 h-8 rounded-lg bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 flex items-center justify-center text-gray-500 dark:text-gray-400 hover:text-accent-600 dark:hover:text-accent-400 hover:border-accent-300 transition-colors shadow-sm">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
        </button>
        <button onclick="deleteSupplier('${s.id}')" title="Excluir" class="w-8 h-8 rounded-lg bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 flex items-center justify-center text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:border-red-300 transition-colors shadow-sm">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
        </button>
      </div>
      <div class="flex items-center gap-3 mb-4">
        <div class="w-12 h-12 rounded-xl bg-wine-900 dark:bg-wine-800 flex items-center justify-center text-white flex-shrink-0">
          <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/></svg>
        </div>
        <div class="min-w-0">
          <h4 class="font-bold text-gray-900 dark:text-white truncate">${s.name}</h4>
          ${s.cnpj ? `<p class="text-xs text-gray-500 dark:text-gray-400">${s.cnpj}</p>` : ''}
        </div>
      </div>
      <div class="space-y-1.5">
        ${s.phone ? `<p class="text-sm text-gray-600 dark:text-gray-400 flex items-center gap-2"><svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/></svg> ${s.phone}</p>` : ''}
        ${s.email ? `<p class="text-sm text-gray-600 dark:text-gray-400 flex items-center gap-2"><svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg> ${s.email}</p>` : ''}
        ${s.contact ? `<p class="text-sm text-gray-600 dark:text-gray-400 flex items-center gap-2"><svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg> ${s.contact}</p>` : ''}
      </div>
    </div>
  `).join('');
}

function updateSupplierSelects() {
  const options = suppliers.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
  
  const productSupplier = document.getElementById('product-supplier');
  if (productSupplier) {
    const currentValue = productSupplier.value;
    productSupplier.innerHTML = '<option value="">Selecione</option>' + options;
    productSupplier.value = currentValue;
  }
  
  const entrySupplier = document.getElementById('entry-supplier');
  if (entrySupplier) {
    entrySupplier.innerHTML = '<option value="">Selecione um fornecedor</option>' + options;
  }
}

function updateProductSelects() {
  const options = products.map(p => `<option value="${p.id}">${p.name} (${p.stock} un)</option>`).join('');
  
  const entryProduct = document.getElementById('entry-product');
  if (entryProduct) {
    entryProduct.innerHTML = '<option value="">Selecione um produto</option>' + options;
  }
}

// Stock Entry Functions
async function saveStockEntry(e) {
  e.preventDefault();
  
  const productId = document.getElementById('entry-product').value;
  const quantity = parseInt(document.getElementById('entry-quantity').value);
  const cost = parseFloat(document.getElementById('entry-cost').value);
  
  const product = products.find(p => p.id === productId);
  if (!product) {
    showToast('Produto não encontrado', 'error');
    return;
  }
  
  const entry = {
    id: crypto.randomUUID(),
    product_id: productId,
    product_name: product.name,
    supplier_id: document.getElementById('entry-supplier').value || null,
    quantity,
    cost,
    total: quantity * cost,
    invoice: document.getElementById('entry-invoice').value,
    batch: document.getElementById('entry-batch').value,
    expiry: document.getElementById('entry-expiry').value || null,
    notes: document.getElementById('entry-notes').value,
    created_at: new Date().toISOString()
  };
  
  // Calculate new stock and average cost
  const newStock = product.stock + quantity;
  const avgCost = newStock > 0 ? ((product.cost * product.stock) + (cost * quantity)) / newStock : cost;
  
  try {
    // Save entry and update product in DB
    await dbInsert('stock_entries', entry);
    await dbUpdate('products', productId, { stock: newStock, cost: avgCost });
    
    // Reload all data from DB
    await loadAllData();
    
    document.getElementById('stock-entry-form').reset();
    updateDashboard();
    updateAlerts();
    showToast('Entrada registrada!');
  } catch (err) {
    console.error('Erro ao registrar entrada:', err);
    showToast('Erro ao registrar entrada no banco de dados: ' + (err.message || err), 'error');
  }
}

function renderRecentEntries() {
  const container = document.getElementById('recent-entries');
  const recent = stockEntries.slice(0, 10);
  
  if (recent.length === 0) {
    container.innerHTML = '<p class="text-gray-500 dark:text-gray-400 text-sm">Nenhuma entrada registrada</p>';
    return;
  }
  
  container.innerHTML = recent.map(e => `
    <div class="flex items-center gap-3 p-3 rounded-xl bg-white/50 dark:bg-gray-800/50">
      <div class="w-10 h-10 rounded-lg bg-green-100 dark:bg-green-900/50 flex items-center justify-center text-green-600">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 11l5-5m0 0l5 5m-5-5v12"/></svg>
      </div>
      <div class="flex-1 min-w-0">
        <p class="font-medium text-gray-900 dark:text-white text-sm truncate">${e.product_name}</p>
        <p class="text-xs text-gray-500 dark:text-gray-400">+${e.quantity} un${isAdmin() ? ` • R$ ${e.cost.toFixed(2)}/un` : ''}</p>
      </div>
    </div>
  `).join('');
}

// ============================================
// POS / CASH REGISTER SYSTEM
// ============================================

let posView = 'grid'; // 'grid' | 'list'

function setPosView(view) {
  posView = view;
  document.getElementById('pos-view-grid').className = view === 'grid'
    ? 'p-2 rounded-lg bg-white dark:bg-wine-800 shadow-sm text-wine-700 dark:text-wine-200'
    : 'p-2 rounded-lg text-wine-400 dark:text-wine-500 hover:text-wine-600';
  document.getElementById('pos-view-list').className = view === 'list'
    ? 'p-2 rounded-lg bg-white dark:bg-wine-800 shadow-sm text-wine-700 dark:text-wine-200'
    : 'p-2 rounded-lg text-wine-400 dark:text-wine-500 hover:text-wine-600';
  renderPosProducts();
}

function renderPosProductCard(p, showPrices) {
  if (posView === 'list') {
    return `
      <button onclick="addToCart('${p.id}', event)" class="pos-product-card flex items-center gap-3 w-full col-span-full">
        <div class="w-9 h-9 rounded-lg bg-wine-50 dark:bg-wine-900/50 flex items-center justify-center flex-shrink-0 text-wine-600 dark:text-wine-400">${getCategoryIcon(p.category)}</div>
        <div class="flex-1 min-w-0 text-left">
          <p class="font-semibold text-gray-900 dark:text-white text-sm truncate">${p.name}</p>
          <p class="text-xs text-gray-400 dark:text-wine-500">${getCategoryLabel(p.category)}${p.brand ? ' · ' + p.brand : ''}</p>
        </div>
        ${showPrices ? `<span class="text-accent-600 dark:text-accent-400 font-bold text-sm">R$ ${p.price.toFixed(2)}</span>` : ''}
        <span class="text-xs text-gray-400 dark:text-wine-500 tabular-nums">${p.stock} un</span>
      </button>`;
  }
  return `
    <button onclick="addToCart('${p.id}', event)" class="pos-product-card flex flex-col gap-1.5">
      <div class="flex items-center justify-between w-full">
        <div class="w-8 h-8 rounded-lg bg-wine-50 dark:bg-wine-900/50 flex items-center justify-center text-wine-600 dark:text-wine-400">${getCategoryIcon(p.category)}</div>
        <span class="text-[10px] font-medium text-gray-400 dark:text-wine-500 tabular-nums">${p.stock} un</span>
      </div>
      <p class="font-semibold text-gray-900 dark:text-white text-sm truncate w-full">${p.name}</p>
      ${showPrices ? `<p class="text-accent-600 dark:text-accent-400 font-bold text-sm">R$ ${p.price.toFixed(2)}</p>` : ''}
    </button>`;
}

function renderPosProducts() {
  const container = document.getElementById('pos-products');
  const availableProducts = products.filter(p => p.stock > 0);
  
  if (availableProducts.length === 0) {
    container.innerHTML = `
      <div class="col-span-full flex flex-col items-center justify-center py-12 text-gray-400 dark:text-wine-600">
        <svg class="w-16 h-16 mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/></svg>
        <p class="font-medium">Nenhum produto disponível</p>
        <p class="text-xs mt-1">Cadastre produtos com estoque para exibir aqui</p>
      </div>`;
    return;
  }
  
  const showPrices = isAdmin();
  container.className = posView === 'list'
    ? 'flex flex-col gap-2 max-h-[520px] overflow-y-auto scrollbar-thin pr-1'
    : 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 max-h-[520px] overflow-y-auto scrollbar-thin pr-1';
  container.innerHTML = availableProducts.map(p => renderPosProductCard(p, showPrices)).join('');
}

function filterPosProducts() {
  const search = document.getElementById('pos-search').value.toLowerCase();
  const container = document.getElementById('pos-products');
  
  const filtered = products.filter(p => 
    p.stock > 0 && (
      p.name.toLowerCase().includes(search) ||
      (p.barcode && p.barcode.includes(search)) ||
      (p.code && p.code.toLowerCase().includes(search)) ||
      (p.brand && p.brand.toLowerCase().includes(search)) ||
      p.id.toLowerCase().includes(search)
    )
  );
  
  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="col-span-full flex flex-col items-center justify-center py-12 text-gray-400 dark:text-wine-600">
        <svg class="w-12 h-12 mb-2 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
        <p class="font-medium text-sm">Nenhum produto encontrado</p>
      </div>`;
    return;
  }
  
  const showPrices = isAdmin();
  container.className = posView === 'list'
    ? 'flex flex-col gap-2 max-h-[520px] overflow-y-auto scrollbar-thin pr-1'
    : 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 max-h-[520px] overflow-y-auto scrollbar-thin pr-1';
  container.innerHTML = filtered.map(p => renderPosProductCard(p, showPrices)).join('');
}

function addToCart(productId, event) {
  const product = products.find(p => p.id === productId);
  if (!product) return;
  
  // Ripple effect on product card
  if (event && event.currentTarget) {
    const btn = event.currentTarget;
    const ripple = document.createElement('div');
    ripple.className = 'pos-ripple';
    const rect = btn.getBoundingClientRect();
    ripple.style.left = (event.clientX - rect.left - 20) + 'px';
    ripple.style.top = (event.clientY - rect.top - 20) + 'px';
    btn.appendChild(ripple);
    setTimeout(() => ripple.remove(), 500);
  }
  
  const existingItem = cart.find(item => item.product_id === productId);
  
  if (existingItem) {
    if (existingItem.quantity < product.stock) {
      existingItem.quantity++;
    } else {
      showToast('Estoque insuficiente', 'warning');
      return;
    }
  } else {
    cart.push({
      product_id: productId,
      name: product.name,
      price: product.price,
      cost: product.cost,
      quantity: 1
    });
  }
  
  renderCart();
  animateTotal();
}

function removeFromCart(productId) {
  cart = cart.filter(item => item.product_id !== productId);
  renderCart();
}

function updateCartQuantity(productId, delta) {
  const item = cart.find(i => i.product_id === productId);
  const product = products.find(p => p.id === productId);
  
  if (!item || !product) return;
  
  const newQty = item.quantity + delta;
  
  if (newQty <= 0) {
    removeFromCart(productId);
  } else if (newQty <= product.stock) {
    item.quantity = newQty;
    renderCart();
    animateTotal();
  } else {
    showToast('Estoque insuficiente', 'warning');
  }
}

function renderCart() {
  const container = document.getElementById('cart-items');
  const itemCountEl = document.getElementById('pos-item-count');
  const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);
  
  if (itemCountEl) itemCountEl.textContent = `${totalItems} ${totalItems === 1 ? 'item' : 'itens'}`;
  
  if (cart.length === 0) {
    container.innerHTML = `
      <div class="flex flex-col items-center justify-center py-8 text-gray-400 dark:text-wine-600">
        <svg class="w-12 h-12 mb-2 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z"/></svg>
        <p class="text-sm font-medium">Selecione produtos ao lado</p>
      </div>`;
    updateCartTotal();
    return;
  }
  
  const showPrices = isAdmin();
  container.innerHTML = cart.map((item, idx) => `
    <div class="pos-cart-item pos-cart-item-enter" style="animation-delay: ${idx * 30}ms">
      <div class="w-8 h-8 rounded-lg bg-accent-500/10 dark:bg-accent-500/20 flex items-center justify-center text-accent-600 dark:text-accent-400 font-bold text-xs flex-shrink-0">
        ${item.quantity}
      </div>
      <div class="flex-1 min-w-0">
        <p class="font-semibold text-gray-900 dark:text-white text-sm truncate">${item.name}</p>
        ${showPrices ? `<p class="text-xs text-gray-400 dark:text-wine-500">R$ ${item.price.toFixed(2)} × ${item.quantity} ${showPrices ? '= <span class="text-gray-700 dark:text-wine-200 font-medium">R$ ' + (item.price * item.quantity).toFixed(2) + '</span>' : ''}</p>` : ''}
      </div>
      <div class="flex items-center gap-0.5 flex-shrink-0">
        <button onclick="updateCartQuantity('${item.product_id}', -1)" class="w-7 h-7 rounded-lg text-wine-500 dark:text-wine-400 flex items-center justify-center hover:bg-wine-100 dark:hover:bg-wine-800 transition-colors text-lg font-bold">−</button>
        <button onclick="updateCartQuantity('${item.product_id}', 1)" class="w-7 h-7 rounded-lg text-wine-500 dark:text-wine-400 flex items-center justify-center hover:bg-wine-100 dark:hover:bg-wine-800 transition-colors text-lg font-bold">+</button>
      </div>
      <button onclick="removeFromCart('${item.product_id}')" class="w-6 h-6 flex items-center justify-center rounded text-gray-300 dark:text-wine-700 hover:text-red-500 dark:hover:text-red-400 transition-colors flex-shrink-0">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
      </button>
    </div>
  `).join('');
  
  updateCartTotal();
}

function updateCartTotal() {
  const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  const discountEl = document.getElementById('cart-discount');
  const discount = discountEl ? (parseFloat(discountEl.value) || 0) : 0;
  const total = Math.max(0, subtotal - discount);
  
  const subtotalEl = document.getElementById('cart-subtotal');
  const totalEl = document.getElementById('cart-total');
  
  if (isAdmin()) {
    if (subtotalEl) subtotalEl.textContent = `R$ ${subtotal.toFixed(2)}`;
    if (totalEl) totalEl.textContent = `R$ ${total.toFixed(2)}`;
  } else {
    if (subtotalEl) subtotalEl.textContent = '---';
    if (totalEl) totalEl.textContent = '---';
  }
  
  // Update save button state
  const saveBtn = document.getElementById('pos-save-btn');
  if (saveBtn) {
    saveBtn.disabled = cart.length === 0;
    saveBtn.style.opacity = cart.length === 0 ? '0.5' : '1';
    saveBtn.style.pointerEvents = cart.length === 0 ? 'none' : 'auto';
  }
}

function animateTotal() {
  const totalEl = document.getElementById('cart-total');
  if (!totalEl) return;
  totalEl.classList.add('pos-total-bump');
  setTimeout(() => totalEl.classList.remove('pos-total-bump'), 350);
}

function clearCart() {
  cart = [];
  const discountEl = document.getElementById('cart-discount');
  if (discountEl) discountEl.value = 0;
  const clientInput = document.getElementById('quote-client-name');
  const notesInput = document.getElementById('quote-notes');
  if (clientInput) clientInput.value = '';
  if (notesInput) notesInput.value = '';
  renderCart();
}

async function saveQuote() {
  if (cart.length === 0) {
    showToast('Adicione itens ao orçamento', 'warning');
    return;
  }
  
  const saveBtn = document.getElementById('pos-save-btn');
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<svg class="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg> Salvando...';
  }
  
  const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  const discount = parseFloat(document.getElementById('cart-discount').value) || 0;
  const total = Math.max(0, subtotal - discount);
  const totalCost = cart.reduce((sum, item) => sum + (item.cost * item.quantity), 0);
  const profit = total - totalCost;
  const clientName = (document.getElementById('quote-client-name')?.value || '').trim();
  const notes = (document.getElementById('quote-notes')?.value || '').trim();
  
  const sale = {
    id: crypto.randomUUID(),
    items: cart.map(item => ({
      product_id: item.product_id,
      name: item.name,
      price: item.price,
      cost: item.cost,
      quantity: item.quantity
    })),
    subtotal,
    discount,
    total,
    profit,
    shift: getCurrentShift(),
    payment_method: clientName ? `pendente - ${clientName}` : 'pendente',
    created_at: new Date().toISOString()
  };
  
  try {
    await dbInsert('sales', sale);
    
    for (const item of cart) {
      const product = products.find(p => p.id === item.product_id);
      if (product) {
        const newStock = product.stock - item.quantity;
        await dbUpdate('products', product.id, { stock: newStock });
      }
    }
    
    // Success flash on register
    const register = document.querySelector('.pos-register');
    if (register) register.classList.add('pos-success-flash');
    setTimeout(() => register && register.classList.remove('pos-success-flash'), 800);
    
    await loadAllData();
    clearCart();
    updateDashboard();
    updateAlerts();
    renderQuoteHistory();
    showToast(isAdmin() ? `Orçamento de R$ ${total.toFixed(2)} salvo!` : 'Orçamento salvo!');
  } catch (err) {
    console.error('Erro ao salvar orçamento:', err);
    showToast('Erro ao salvar orçamento: ' + (err.message || err), 'error');
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.innerHTML = '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg> Salvar Orçamento';
    }
  }
}

// ============================================
// QUOTES HISTORY PAGE
// ============================================

function renderQuoteHistory() {
  const list = document.getElementById('quote-history-list');
  const summaryEl = document.getElementById('quote-history-summary');
  const statTotal = document.getElementById('quotes-stat-total');
  const statValue = document.getElementById('quotes-stat-value');
  const statToday = document.getElementById('quotes-stat-today');
  const statAvg = document.getElementById('quotes-stat-avg');

  // Search & sort
  const search = (document.getElementById('quotes-search')?.value || '').toLowerCase();
  const sort = document.getElementById('quotes-sort')?.value || 'newest';

  let filtered = sales.filter(s => {
    if (!search) return true;
    const clientInfo = (s.payment_method || '').toLowerCase();
    const items = Array.isArray(s.items) ? s.items : [];
    const itemNames = items.map(it => (it.name || '').toLowerCase()).join(' ');
    return clientInfo.includes(search) || itemNames.includes(search);
  });

  // Sort
  if (sort === 'newest') filtered.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  else if (sort === 'oldest') filtered.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  else if (sort === 'highest') filtered.sort((a, b) => (b.total || 0) - (a.total || 0));
  else if (sort === 'lowest') filtered.sort((a, b) => (a.total || 0) - (b.total || 0));

  // Stats (always over ALL sales, not filtered)
  const totalAll = sales.reduce((s, v) => s + (v.total || 0), 0);
  const todayStr = new Date().toDateString();
  const todayCount = sales.filter(s => new Date(s.created_at).toDateString() === todayStr).length;
  const avg = sales.length > 0 ? totalAll / sales.length : 0;

  if (statTotal) statTotal.textContent = sales.length;
  if (statValue) statValue.textContent = `R$ ${totalAll.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  if (statToday) statToday.textContent = todayCount;
  if (statAvg) statAvg.textContent = `R$ ${avg.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  if (summaryEl) summaryEl.textContent = sales.length > 0
    ? `${sales.length} orçamento${sales.length > 1 ? 's' : ''} · Total R$ ${totalAll.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
    : 'Nenhum orçamento';

  if (filtered.length === 0) {
    if (list) list.innerHTML = `
      <div class="flex flex-col items-center justify-center py-16 text-gray-400 dark:text-wine-600">
        <svg class="w-20 h-20 mb-4 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
        <p class="font-semibold text-lg">Nenhum orçamento ${search ? 'encontrado' : 'salvo'}</p>
        <p class="text-sm mt-1 opacity-70">${search ? 'Tente outra busca' : 'Crie seu primeiro orçamento no caixa'}</p>
      </div>`;
    return;
  }

  const showPrices = isAdmin();
  if (list) {
    list.innerHTML = filtered.map((s, idx) => {
      const clientInfo = (s.payment_method && s.payment_method !== 'pendente')
        ? s.payment_method.replace('pendente - ', '')
        : null;
      const items = Array.isArray(s.items) ? s.items : [];
      const itemCount = items.reduce((sum, it) => sum + (it.quantity || 0), 0);
      const date = new Date(s.created_at);
      const dateStr = date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
      const timeStr = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      const globalIdx = sales.indexOf(s);
      const quoteNum = sales.length - globalIdx;

      return `
        <div class="quote-history-card">
          <div class="flex items-start justify-between mb-3">
            <div class="flex items-center gap-2.5">
              <div class="w-10 h-10 rounded-xl bg-accent-500/10 dark:bg-accent-500/20 flex items-center justify-center flex-shrink-0">
                <span class="text-accent-600 dark:text-accent-400 font-bold text-sm">#${quoteNum}</span>
              </div>
              <div class="min-w-0">
                ${clientInfo ? `<p class="font-bold text-gray-900 dark:text-white text-sm truncate">${clientInfo}</p>` : `<p class="font-bold text-gray-900 dark:text-white text-sm">Orçamento #${quoteNum}</p>`}
                <p class="text-xs text-gray-400 dark:text-wine-500">${dateStr} às ${timeStr} · ${itemCount} ${itemCount === 1 ? 'item' : 'itens'}</p>
              </div>
            </div>
            ${showPrices ? `<span class="text-lg font-black text-accent-600 dark:text-accent-400 tabular-nums flex-shrink-0">R$ ${(s.total || 0).toFixed(2)}</span>` : ''}
          </div>
          <div class="flex flex-wrap gap-1.5">
            ${items.slice(0, 6).map(it => `
              <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-gray-100 dark:bg-wine-900/50 text-xs font-medium text-gray-600 dark:text-wine-300">
                <span class="text-accent-500 font-bold">${it.quantity}×</span> ${(it.name || '').length > 22 ? (it.name || '').substring(0, 22) + '…' : (it.name || '')}
              </span>
            `).join('')}
            ${items.length > 6 ? `<span class="inline-flex items-center px-2.5 py-1 rounded-lg bg-gray-100 dark:bg-wine-900/50 text-xs text-gray-400">+${items.length - 6} mais</span>` : ''}
          </div>
          ${s.discount > 0 && showPrices ? `<p class="text-xs text-green-600 dark:text-green-400 mt-2">Desconto: R$ ${s.discount.toFixed(2)}</p>` : ''}
        </div>`;
    }).join('');
  }
}

// Financial Functions
async function saveExpense(e) {
  e.preventDefault();
  
  const expense = {
    id: crypto.randomUUID(),
    description: document.getElementById('expense-description').value,
    amount: parseFloat(document.getElementById('expense-amount').value),
    category: document.getElementById('expense-category').value,
    created_at: new Date().toISOString()
  };
  
  try {
    await dbInsert('expenses', expense);
    
    // Reload from DB
    await loadAllData();
    
    document.getElementById('expense-form').reset();
    updateFinancials();
    renderRecentTransactions();
    showToast('Despesa registrada!');
  } catch (err) {
    console.error('Erro ao registrar despesa:', err);
    showToast('Erro ao registrar despesa no banco de dados: ' + (err.message || err), 'error');
  }
}

function updateFinancials() {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  
  const monthSales = sales.filter(s => new Date(s.created_at) >= monthStart);
  const monthExpenses = expenses.filter(e => new Date(e.created_at) >= monthStart);
  
  const revenue = monthSales.reduce((sum, s) => sum + s.total, 0);
  const expenseTotal = monthExpenses.reduce((sum, e) => sum + e.amount, 0);
  const profit = monthSales.reduce((sum, s) => sum + s.profit, 0) - expenseTotal;
  const quoteCount = monthSales.length;
  
  document.getElementById('financial-revenue').textContent = `R$ ${revenue.toFixed(2)}`;
  document.getElementById('financial-expenses').textContent = `R$ ${expenseTotal.toFixed(2)}`;
  document.getElementById('financial-profit').textContent = `R$ ${profit.toFixed(2)}`;
  document.getElementById('financial-profit').className = `text-2xl font-bold ${profit >= 0 ? 'text-blue-600 dark:text-blue-400' : 'text-red-600 dark:text-red-400'}`;
  document.getElementById('financial-credit').textContent = quoteCount;
  
  renderRecentTransactions();
}

function renderRecentTransactions() {
  const container = document.getElementById('recent-transactions');
  
  const transactions = [
    ...sales.slice(0, 5).map(s => ({ type: 'sale', amount: s.total, description: `Orçamento${s.payment_method && s.payment_method !== 'pendente' ? ' - ' + s.payment_method.replace('pendente - ', '') : ''}`, date: s.created_at })),
    ...expenses.slice(0, 5).map(e => ({ type: 'expense', amount: e.amount, description: e.description, date: e.created_at }))
  ].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 10);
  
  if (transactions.length === 0) {
    container.innerHTML = '<p class="text-gray-500 dark:text-gray-400 text-sm">Nenhuma transação registrada</p>';
    return;
  }
  
  container.innerHTML = transactions.map(t => `
    <div class="flex items-center gap-3 p-3 rounded-xl bg-white/50 dark:bg-gray-800/50">
      <div class="w-10 h-10 rounded-lg ${t.type === 'sale' ? 'bg-green-100 dark:bg-green-900/50 text-green-600' : 'bg-red-100 dark:bg-red-900/50 text-red-600'} flex items-center justify-center">
        ${t.type === 'sale' ? '+' : '-'}
      </div>
      <div class="flex-1 min-w-0">
        <p class="font-medium text-gray-900 dark:text-white text-sm truncate">${t.description}</p>
        <p class="text-xs text-gray-500 dark:text-gray-400">${new Date(t.date).toLocaleDateString('pt-BR')}</p>
      </div>
      <p class="font-bold ${t.type === 'sale' ? 'text-green-600' : 'text-red-600'}">
        ${t.type === 'sale' ? '+' : '-'}R$ ${t.amount.toFixed(2)}
      </p>
    </div>
  `).join('');
}

// Dashboard Functions
function updateDashboard() {
  // Total stock
  const totalStock = products.reduce((sum, p) => sum + p.stock, 0);
  document.getElementById('stat-total-stock').textContent = totalStock.toLocaleString();
  
  // Today's sales
  const today = new Date().toDateString();
  const todaySales = sales.filter(s => new Date(s.created_at).toDateString() === today);
  const dailyTotal = todaySales.reduce((sum, s) => sum + s.total, 0);
  const dailyProfit = todaySales.reduce((sum, s) => sum + s.profit, 0);
  
  document.getElementById('stat-daily-sales').textContent = `R$ ${dailyTotal.toFixed(0)}`;
  document.getElementById('stat-daily-profit').textContent = `R$ ${dailyProfit.toFixed(0)}`;
  
  // Low stock
  const lowStock = products.filter(p => p.stock <= p.min_stock).length;
  document.getElementById('stat-low-stock').textContent = lowStock;
  
  // Update alerts badge
  const alertCount = getAlerts().length;
  document.getElementById('alert-count-badge').textContent = `${alertCount} alertas`;
  
  const alertBadge = document.getElementById('alert-badge');
  if (alertCount > 0) {
    alertBadge.textContent = alertCount;
    alertBadge.classList.remove('hidden');
  } else {
    alertBadge.classList.add('hidden');
  }
  
  // Weekly chart
  renderWeeklyChart();
  
  // Top products
  renderTopProducts();
  
  // Recent activity
  renderRecentActivity();
}

function setupSalesChart() {
  renderWeeklyChart();
}

function renderWeeklyChart() {
  const chart = document.getElementById('sales-chart');
  if (!chart) return;

  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=Sun … 6=Sat
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(now);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(now.getDate() + mondayOffset);

  const labels = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
  const weekTotals = [];
  const weekCounts = [];

  for (let d = 0; d < 7; d++) {
    const dayStart = new Date(monday);
    dayStart.setDate(monday.getDate() + d);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayStart.getDate() + 1);

    const daySales = sales.filter(s => {
      const dt = new Date(s.created_at);
      return dt >= dayStart && dt < dayEnd;
    });

    weekTotals.push(daySales.reduce((sum, s) => sum + (s.total || 0), 0));
    weekCounts.push(daySales.length);
  }

  const maxVal = Math.max(...weekTotals, 1);
  const showPrices = isAdmin();
  const todayIdx = dayOfWeek === 0 ? 6 : dayOfWeek - 1;

  chart.innerHTML = weekTotals.map((val, i) => {
    const pct = Math.max((val / maxVal) * 100, 3);
    const isToday = i === todayIdx;
    const hasData = val > 0;

    const barColor = isToday
      ? 'bg-accent-500'
      : hasData
        ? 'bg-wine-400 dark:bg-wine-500'
        : 'bg-gray-200 dark:bg-wine-800/60';

    const label = showPrices
      ? (hasData ? `R$ ${val.toFixed(0)}` : '')
      : (hasData ? `${weekCounts[i]}` : '');

    return `
      <div class="flex items-center gap-3">
        <span class="w-8 text-xs font-semibold ${isToday ? 'text-accent-600 dark:text-accent-400' : 'text-gray-400 dark:text-wine-500'} text-right">${labels[i]}</span>
        <div class="flex-1 h-7 bg-gray-100 dark:bg-wine-900/40 rounded-full overflow-hidden">
          <div class="h-full rounded-full ${barColor} flex items-center justify-end pr-3 transition-all duration-700 ease-out" style="width: ${pct}%">
            ${hasData ? `<span class="text-[11px] font-bold text-white truncate">${label}</span>` : ''}
          </div>
        </div>
        ${isToday ? '<span class="w-2 h-2 rounded-full bg-accent-500 animate-pulse flex-shrink-0"></span>' : '<span class="w-2 flex-shrink-0"></span>'}
      </div>`;
  }).join('');
}

function renderTopProducts() {
  const container = document.getElementById('top-products');
  
  // Calculate sales per product
  const productSales = {};
  sales.forEach(sale => {
    sale.items.forEach(item => {
      productSales[item.product_id] = (productSales[item.product_id] || 0) + item.quantity;
    });
  });
  
  const topProducts = Object.entries(productSales)
    .map(([id, qty]) => {
      const product = products.find(p => p.id === id);
      return product ? { ...product, soldQty: qty } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.soldQty - a.soldQty)
    .slice(0, 5);
  
  if (topProducts.length === 0) {
    container.innerHTML = '<p class="text-gray-500 dark:text-gray-400 text-sm">Nenhum produto com orçamento ainda</p>';
    return;
  }
  
  const maxQty = topProducts[0].soldQty;
  
  container.innerHTML = topProducts.map((p, i) => `
    <div class="flex items-center gap-3">
      <span class="w-6 h-6 rounded-full bg-wine-100 dark:bg-wine-900/50 text-wine-600 dark:text-wine-400 flex items-center justify-center text-sm font-bold">${i + 1}</span>
      <div class="flex-1 min-w-0">
        <p class="font-medium text-gray-900 dark:text-white text-sm truncate">${p.name}</p>
        <div class="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full mt-1">
          <div class="h-2 progress-bar rounded-full" style="width: ${(p.soldQty / maxQty) * 100}%"></div>
        </div>
      </div>
      <span class="text-sm font-medium text-gray-600 dark:text-gray-400">${p.soldQty}</span>
    </div>
  `).join('');
}

function renderRecentActivity() {
  const container = document.getElementById('recent-activity');
  
  const activities = [
    ...sales.slice(0, 3).map(s => ({
      type: 'sale',
      icon: '<svg class="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>',
      text: `Orçamento de R$ ${s.total.toFixed(2)}${s.payment_method && s.payment_method !== 'pendente' ? ' - ' + s.payment_method.replace('pendente - ', '') : ''}`,
      date: s.created_at
    })),
    ...stockEntries.slice(0, 3).map(e => ({
      type: 'entry',
      icon: '<svg class="w-5 h-5 text-accent-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/></svg>',
      text: `Entrada: ${e.quantity}x ${e.product_name}`,
      date: e.created_at
    }))
  ].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5);
  
  if (activities.length === 0) {
    container.innerHTML = '<p class="text-gray-500 dark:text-gray-400 text-sm">Nenhuma atividade recente</p>';
    return;
  }
  
  container.innerHTML = activities.map(a => `
    <div class="flex items-center gap-3 p-3 rounded-xl bg-white/50 dark:bg-gray-800/50">
      <span class="flex-shrink-0">${a.icon}</span>
      <div class="flex-1 min-w-0">
        <p class="text-sm text-gray-900 dark:text-white">${a.text}</p>
        <p class="text-xs text-gray-500 dark:text-gray-400">${new Date(a.date).toLocaleString('pt-BR')}</p>
      </div>
    </div>
  `).join('');
}

// Alerts Functions
function getAlerts() {
  const alerts = [];
  
  // Low stock alerts
  products.filter(p => p.stock <= p.min_stock && p.stock > 0).forEach(p => {
    alerts.push({
      type: 'warning',
      title: 'Estoque baixo',
      message: `${p.name} está com apenas ${p.stock} unidades`,
      icon: '<svg class="w-6 h-6 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>',
      action: 'stock',
      productId: p.id
    });
  });
  
  // Out of stock alerts
  products.filter(p => p.stock <= 0).forEach(p => {
    alerts.push({
      type: 'error',
      title: 'Sem estoque',
      message: `${p.name} está sem estoque`,
      icon: '<svg class="w-6 h-6 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"/></svg>',
      action: 'stock',
      productId: p.id
    });
  });
  
  // Low margin alerts (less than 20%)
  products.filter(p => {
    const margin = p.cost > 0 ? ((p.price - p.cost) / p.cost) * 100 : 0;
    return margin < 20 && margin >= 0;
  }).forEach(p => {
    const margin = ((p.price - p.cost) / p.cost * 100).toFixed(0);
    alerts.push({
      type: 'info',
      title: 'Margem baixa',
      message: `${p.name} tem margem de apenas ${margin}%`,
      icon: '<svg class="w-6 h-6 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>',
      action: 'edit',
      productId: p.id
    });
  });
  
  return alerts;
}

function handleAlertClick(action, productId) {
  const product = products.find(p => p.id === productId);
  if (!product) return;
  
  if (action === 'stock') {
    openQuickStockModal(productId);
  } else if (action === 'edit') {
    navigateTo('products');
    setTimeout(() => openProductModal(product), 150);
  }
}

function updateAlerts() {
  const container = document.getElementById('alerts-list');
  const alerts = getAlerts();
  
  if (alerts.length === 0) {
    container.innerHTML = '<p class="text-gray-500 dark:text-gray-400 text-center py-12">Nenhum alerta no momento</p>';
    return;
  }
  
  container.innerHTML = alerts.map(a => {
    const bgColor = a.type === 'error' ? 'bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-800' :
                   a.type === 'warning' ? 'bg-amber-50 dark:bg-amber-900/30 border-amber-200 dark:border-amber-800' :
                   'bg-blue-50 dark:bg-blue-900/30 border-blue-200 dark:border-blue-800';
    const actionLabel = a.action === 'stock' ? 'Ajustar Estoque' : 'Editar Produto';
    const btnColor = a.type === 'error' ? 'text-red-600 hover:bg-red-100 dark:hover:bg-red-900/50' :
                    a.type === 'warning' ? 'text-amber-600 hover:bg-amber-100 dark:hover:bg-amber-900/50' :
                    'text-blue-600 hover:bg-blue-100 dark:hover:bg-blue-900/50';
    
    return `
      <div class="glass-effect rounded-2xl p-4 shadow-lg ${bgColor} border cursor-pointer alert-card-hover" onclick="handleAlertClick('${a.action}', '${a.productId}')">
        <div class="flex items-start gap-4">
          <span class="flex-shrink-0">${a.icon}</span>
          <div class="flex-1">
            <h4 class="font-bold text-gray-900 dark:text-white">${a.title}</h4>
            <p class="text-sm text-gray-600 dark:text-gray-400">${a.message}</p>
          </div>
          <span class="flex-shrink-0 text-xs font-medium ${btnColor} px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>
            ${actionLabel}
          </span>
        </div>
      </div>
    `;
  }).join('');
}

// ============================================
// REPORTS - Analytics Dashboard
// ============================================

let reportPeriod = 'today';
let reportCharts = {};

function setReportPeriod(period) {
  reportPeriod = period;
  document.querySelectorAll('.report-period-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.period === period);
  });
  refreshReports();
}

function getFilteredSales() {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  
  return sales.filter(s => {
    const d = new Date(s.created_at);
    let matchesPeriod = true;
    switch (reportPeriod) {
      case 'today': matchesPeriod = d >= todayStart; break;
      case '7d': matchesPeriod = d >= new Date(now - 7 * 86400000); break;
      case '30d': matchesPeriod = d >= new Date(now - 30 * 86400000); break;
      case '90d': matchesPeriod = d >= new Date(now - 90 * 86400000); break;
      default: matchesPeriod = true;
    }
    let matchesShift = true;
    if (reportShiftFilter !== 'all') {
      const saleShift = s.shift || getShiftForTime(s.created_at);
      matchesShift = saleShift === reportShiftFilter;
    }
    return matchesPeriod && matchesShift;
  });
}

function setReportShift(shift) {
  reportShiftFilter = shift;
  document.querySelectorAll('.report-shift-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.shift === shift);
  });
  refreshReports();
}

function getChartColors() {
  const isDark = document.documentElement.classList.contains('dark');
  return {
    accent: '#d49b28',
    accentLight: 'rgba(212, 155, 40, 0.15)',
    green: '#22c55e',
    greenLight: 'rgba(34, 197, 94, 0.15)',
    text: isDark ? '#eceef3' : '#2e3340',
    textMuted: isDark ? '#8692a7' : '#67708a',
    grid: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
    surface: isDark ? '#1c202a' : '#ffffff',
    red: '#ef4444',
    amber: '#f59e0b',
    blue: '#3b82f6',
    purple: '#8b5cf6',
    cyan: '#06b6d4',
    pink: '#ec4899',
    palette: isDark
      ? ['#d49b28', '#22c55e', '#3b82f6', '#8b5cf6', '#ef4444', '#06b6d4', '#ec4899', '#f59e0b']
      : ['#1c202a', '#2e3340', '#43495c', '#525b71', '#67708a', '#8692a7', '#b1b9c8', '#d5d9e2']
  };
}

function refreshReports() {
  const filtered = getFilteredSales();
  const c = getChartColors();

  // --- KPIs ---
  const totalRevenue = filtered.reduce((s, v) => s + v.total, 0);
  const totalProfit = filtered.reduce((s, v) => s + v.profit, 0);
  const totalCount = filtered.length;
  const avgTicket = totalCount > 0 ? totalRevenue / totalCount : 0;

  document.getElementById('rpt-kpi-revenue').textContent = `R$ ${totalRevenue.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;
  document.getElementById('rpt-kpi-profit').textContent = `R$ ${totalProfit.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;
  document.getElementById('rpt-kpi-count').textContent = totalCount.toLocaleString('pt-BR');
  document.getElementById('rpt-kpi-avg').textContent = `R$ ${avgTicket.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;

  // --- Revenue vs Profit Trend ---
  renderTrendChart(filtered, c);

  // --- Category Donut ---
  renderCategoryChart(filtered, c);

  // --- Top Sellers ---
  renderTopSellersChart(filtered, c);

  // --- Margin Analysis ---
  renderMarginChart(c);

  // --- ABC Curve ---
  renderABCChart(filtered, c);

  // --- Expiring Products List ---
  renderExpiringList();

  // --- Low Turnover List ---
  renderLowTurnoverList();
}

// Destroy and recreate chart helper
function makeChart(canvasId, config) {
  if (reportCharts[canvasId]) {
    reportCharts[canvasId].destroy();
  }
  const ctx = document.getElementById(canvasId);
  if (!ctx) return null;
  reportCharts[canvasId] = new Chart(ctx, config);
  return reportCharts[canvasId];
}

// ---- Trend Chart (Revenue vs Profit line) ----
function renderTrendChart(filtered, c) {
  // Group by day or month depending on period
  const groups = {};
  const useDaily = reportPeriod === 'today' || reportPeriod === '7d' || reportPeriod === '30d';

  filtered.forEach(s => {
    const d = new Date(s.created_at);
    const key = useDaily
      ? d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
      : d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
    if (!groups[key]) groups[key] = { revenue: 0, profit: 0 };
    groups[key].revenue += s.total;
    groups[key].profit += s.profit;
  });

  const labels = Object.keys(groups);
  const revenues = labels.map(k => groups[k].revenue);
  const profits = labels.map(k => groups[k].profit);

  const labelText = {
    'today': 'Hoje', '7d': 'Últimos 7 dias', '30d': 'Últimos 30 dias',
    '90d': 'Últimos 90 dias', 'all': 'Todo o período'
  };
  const el = document.getElementById('rpt-trend-label');
  if (el) el.textContent = labelText[reportPeriod] || '';

  makeChart('rpt-chart-trend', {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Receita',
          data: revenues,
          borderColor: c.accent,
          backgroundColor: c.accentLight,
          fill: true,
          tension: 0.35,
          pointRadius: labels.length > 20 ? 0 : 3,
          pointHoverRadius: 5,
          borderWidth: 2
        },
        {
          label: 'Lucro',
          data: profits,
          borderColor: c.green,
          backgroundColor: c.greenLight,
          fill: true,
          tension: 0.35,
          pointRadius: labels.length > 20 ? 0 : 3,
          pointHoverRadius: 5,
          borderWidth: 2
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          position: 'top',
          align: 'end',
          labels: { color: c.textMuted, usePointStyle: true, pointStyle: 'circle', padding: 16, font: { size: 11, family: 'Inter' } }
        },
        tooltip: {
          backgroundColor: c.surface,
          titleColor: c.text,
          bodyColor: c.textMuted,
          borderColor: c.grid,
          borderWidth: 1,
          padding: 12,
          titleFont: { family: 'Inter', weight: '600' },
          bodyFont: { family: 'Inter' },
          callbacks: {
            label: ctx => `${ctx.dataset.label}: R$ ${ctx.raw.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`
          }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: c.textMuted, font: { size: 10, family: 'Inter' } } },
        y: {
          grid: { color: c.grid },
          ticks: {
            color: c.textMuted,
            font: { size: 10, family: 'Inter' },
            callback: v => 'R$ ' + (v >= 1000 ? (v/1000).toFixed(1) + 'k' : v.toFixed(0))
          }
        }
      }
    }
  });
}

// ---- Category Donut ----
function renderCategoryChart(filtered, c) {
  const catTotals = {};
  filtered.forEach(s => {
    s.items.forEach(item => {
      const prod = products.find(p => p.id === item.product_id);
      const cat = prod ? prod.category : 'Outros';
      catTotals[cat] = (catTotals[cat] || 0) + item.price * item.quantity;
    });
  });

  const labels = Object.keys(catTotals);
  const data = Object.values(catTotals);

  makeChart('rpt-chart-categories', {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: c.palette.slice(0, labels.length),
        borderWidth: 0,
        hoverOffset: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '65%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: c.textMuted, usePointStyle: true, pointStyle: 'circle', padding: 10, font: { size: 10, family: 'Inter' } }
        },
        tooltip: {
          backgroundColor: c.surface,
          titleColor: c.text,
          bodyColor: c.textMuted,
          borderColor: c.grid,
          borderWidth: 1,
          padding: 10,
          titleFont: { family: 'Inter', weight: '600' },
          bodyFont: { family: 'Inter' },
          callbacks: {
            label: ctx => {
              const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
              const pct = total > 0 ? ((ctx.raw / total) * 100).toFixed(1) : 0;
              return `${ctx.label}: R$ ${ctx.raw.toLocaleString('pt-BR', {minimumFractionDigits: 2})} (${pct}%)`;
            }
          }
        }
      }
    }
  });
}

// ---- Top Sellers Horizontal Bar ----
function renderTopSellersChart(filtered, c) {
  const productSales = {};
  filtered.forEach(s => {
    s.items.forEach(item => {
      if (!productSales[item.product_id]) productSales[item.product_id] = { name: item.name, qty: 0 };
      productSales[item.product_id].qty += item.quantity;
    });
  });

  const sorted = Object.values(productSales).sort((a, b) => b.qty - a.qty).slice(0, 10);
  const labels = sorted.map(p => p.name.length > 20 ? p.name.substring(0, 20) + '...' : p.name);
  const data = sorted.map(p => p.qty);

  makeChart('rpt-chart-top-sellers', {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Qtd Vendida',
        data,
        backgroundColor: c.accent,
        borderRadius: 4,
        barThickness: 18
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: 'y',
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: c.surface,
          titleColor: c.text,
          bodyColor: c.textMuted,
          borderColor: c.grid,
          borderWidth: 1,
          padding: 10,
          titleFont: { family: 'Inter', weight: '600' },
          bodyFont: { family: 'Inter' },
          callbacks: { label: ctx => `${ctx.raw} unidades` }
        }
      },
      scales: {
        x: {
          grid: { color: c.grid },
          ticks: { color: c.textMuted, font: { size: 10, family: 'Inter' } }
        },
        y: {
          grid: { display: false },
          ticks: { color: c.text, font: { size: 11, family: 'Inter' } }
        }
      }
    }
  });
}

// ---- Margin Bar Chart ----
function renderMarginChart(c) {
  const sorted = products
    .map(p => ({
      name: p.name,
      margin: p.cost > 0 ? ((p.price - p.cost) / p.cost) * 100 : 0
    }))
    .filter(p => p.margin > 0)
    .sort((a, b) => b.margin - a.margin)
    .slice(0, 10);

  const labels = sorted.map(p => p.name.length > 20 ? p.name.substring(0, 20) + '...' : p.name);
  const data = sorted.map(p => p.margin);
  const colors = data.map(v => v >= 30 ? c.green : v >= 15 ? c.amber : c.red);

  makeChart('rpt-chart-margin', {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Margem %',
        data,
        backgroundColor: colors,
        borderRadius: 4,
        barThickness: 18
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: 'y',
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: c.surface,
          titleColor: c.text,
          bodyColor: c.textMuted,
          borderColor: c.grid,
          borderWidth: 1,
          padding: 10,
          titleFont: { family: 'Inter', weight: '600' },
          bodyFont: { family: 'Inter' },
          callbacks: { label: ctx => `Margem: ${ctx.raw.toFixed(1)}%` }
        }
      },
      scales: {
        x: {
          grid: { color: c.grid },
          ticks: { color: c.textMuted, font: { size: 10, family: 'Inter' }, callback: v => v + '%' }
        },
        y: {
          grid: { display: false },
          ticks: { color: c.text, font: { size: 11, family: 'Inter' } }
        }
      }
    }
  });
}

// ---- ABC Pareto Chart ----
function renderABCChart(filtered, c) {
  const productRevenue = {};
  filtered.forEach(s => {
    s.items.forEach(item => {
      productRevenue[item.product_id] = (productRevenue[item.product_id] || 0) + (item.price * item.quantity);
    });
  });

  const sorted = Object.entries(productRevenue)
    .map(([id, revenue]) => { const p = products.find(pr => pr.id === id); return p ? { name: p.name, revenue } : null; })
    .filter(Boolean)
    .sort((a, b) => b.revenue - a.revenue);

  const totalRevenue = sorted.reduce((s, p) => s + p.revenue, 0);
  let accumulated = 0;
  const classified = sorted.map(p => {
    accumulated += p.revenue;
    const pct = totalRevenue > 0 ? (accumulated / totalRevenue) * 100 : 0;
    return { ...p, accPct: pct, classe: pct <= 80 ? 'A' : pct <= 95 ? 'B' : 'C' };
  });

  // Update ABC counters
  document.getElementById('rpt-abc-a').textContent = classified.filter(p => p.classe === 'A').length;
  document.getElementById('rpt-abc-b').textContent = classified.filter(p => p.classe === 'B').length;
  document.getElementById('rpt-abc-c').textContent = classified.filter(p => p.classe === 'C').length;

  const top = classified.slice(0, 15);
  const labels = top.map(p => p.name.length > 15 ? p.name.substring(0, 15) + '...' : p.name);
  const barData = top.map(p => p.revenue);
  const lineData = top.map(p => p.accPct);
  const barColors = top.map(p => p.classe === 'A' ? c.green : p.classe === 'B' ? c.amber : c.red);

  makeChart('rpt-chart-abc', {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Receita',
          data: barData,
          backgroundColor: barColors,
          borderRadius: 3,
          barThickness: 14,
          yAxisID: 'y'
        },
        {
          label: '% Acumulado',
          data: lineData,
          type: 'line',
          borderColor: c.accent,
          borderWidth: 2,
          pointRadius: 2,
          tension: 0.3,
          fill: false,
          yAxisID: 'y1'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'top',
          align: 'end',
          labels: { color: c.textMuted, usePointStyle: true, pointStyle: 'circle', padding: 12, font: { size: 10, family: 'Inter' } }
        },
        tooltip: {
          backgroundColor: c.surface,
          titleColor: c.text,
          bodyColor: c.textMuted,
          borderColor: c.grid,
          borderWidth: 1,
          padding: 10,
          titleFont: { family: 'Inter', weight: '600' },
          bodyFont: { family: 'Inter' }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { display: false } },
        y: {
          grid: { color: c.grid },
          ticks: {
            color: c.textMuted,
            font: { size: 9, family: 'Inter' },
            callback: v => 'R$' + (v >= 1000 ? (v/1000).toFixed(0) + 'k' : v.toFixed(0))
          }
        },
        y1: {
          position: 'right',
          min: 0,
          max: 100,
          grid: { display: false },
          ticks: { color: c.textMuted, font: { size: 9, family: 'Inter' }, callback: v => v + '%' }
        }
      }
    }
  });
}

// ---- Expiring Products List ----
function renderExpiringList() {
  const expiringProducts = stockEntries
    .filter(e => e.expiry)
    .map(e => {
      const product = products.find(p => p.id === e.product_id);
      const daysUntil = Math.ceil((new Date(e.expiry) - new Date()) / (1000 * 60 * 60 * 24));
      return product ? { name: product.name, expiry: e.expiry, daysUntil, batch: e.batch } : null;
    })
    .filter(p => p && p.daysUntil <= 90)
    .sort((a, b) => a.daysUntil - b.daysUntil);

  const countEl = document.getElementById('rpt-expiring-count');
  if (countEl) countEl.textContent = expiringProducts.length;

  const container = document.getElementById('rpt-expiring-list');
  if (!container) return;

  if (expiringProducts.length === 0) {
    container.innerHTML = '<p class="text-green-600 dark:text-green-400 text-sm font-medium py-4 text-center">Nenhum produto próximo da validade</p>';
    return;
  }

  container.innerHTML = expiringProducts.map(p => {
    const urgencyBg = p.daysUntil <= 30 ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
                    : p.daysUntil <= 60 ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800'
                    : 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800';
    const urgencyText = p.daysUntil <= 30 ? 'text-red-600' : p.daysUntil <= 60 ? 'text-amber-600' : 'text-yellow-600';
    return `
      <div class="p-3 rounded-xl border ${urgencyBg}">
        <div class="flex items-center justify-between">
          <div>
            <p class="font-medium text-gray-900 dark:text-white text-sm">${p.name}</p>
            <p class="text-xs text-gray-500 dark:text-gray-400">Lote: ${p.batch || 'N/A'}</p>
          </div>
          <div class="text-right">
            <p class="font-bold text-sm ${urgencyText}">${p.daysUntil}d</p>
            <p class="text-[10px] text-gray-400">${new Date(p.expiry).toLocaleDateString('pt-BR')}</p>
          </div>
        </div>
      </div>`;
  }).join('');
}

// ---- Low Turnover List ----
function renderLowTurnoverList() {
  const productSales = {};
  sales.forEach(sale => {
    sale.items.forEach(item => {
      productSales[item.product_id] = (productSales[item.product_id] || 0) + item.quantity;
    });
  });

  const lowTurnover = products
    .filter(p => !productSales[p.id] || productSales[p.id] < 3)
    .map(p => ({ ...p, sold: productSales[p.id] || 0, capitalValue: p.cost * p.stock }))
    .sort((a, b) => b.capitalValue - a.capitalValue);

  const totalCapital = lowTurnover.reduce((s, p) => s + p.capitalValue, 0);
  const capitalEl = document.getElementById('rpt-stale-capital');
  if (capitalEl) capitalEl.textContent = `R$ ${totalCapital.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;

  const container = document.getElementById('rpt-low-turnover-list');
  if (!container) return;

  if (lowTurnover.length === 0) {
    container.innerHTML = '<p class="text-green-600 dark:text-green-400 text-sm font-medium py-4 text-center">Todos os produtos têm boa rotatividade</p>';
    return;
  }

  container.innerHTML = lowTurnover.slice(0, 15).map(p => `
    <div class="flex items-center justify-between p-3 rounded-xl bg-white/50 dark:bg-gray-800/30 border border-gray-100 dark:border-gray-700/50">
      <div class="min-w-0 flex-1">
        <p class="font-medium text-gray-900 dark:text-white text-sm truncate">${p.name}</p>
        <p class="text-xs text-gray-500 dark:text-gray-400">${p.stock} un estoque &bull; ${p.sold} vendidos</p>
      </div>
      <p class="text-sm font-semibold text-amber-600 dark:text-amber-400 ml-3">R$ ${p.capitalValue.toFixed(2)}</p>
    </div>
  `).join('');
}

// Legacy report functions (kept for compatibility)
function generateReport(type) {
  const display = document.getElementById('report-display');
  const title = document.getElementById('report-title');
  const content = document.getElementById('report-content');
  display.classList.remove('hidden');

  switch(type) {
    case 'top-sellers':
      title.textContent = 'Detalhes - Mais Vendidos';
      content.innerHTML = generateTopSellersReport();
      break;
    case 'best-margin':
      title.textContent = 'Detalhes - Maior Margem';
      content.innerHTML = generateBestMarginReport();
      break;
    case 'low-turnover':
      title.textContent = 'Detalhes - Produtos Parados';
      content.innerHTML = generateLowTurnoverReport();
      break;
    case 'abc-curve':
      title.textContent = 'Detalhes - Curva ABC';
      content.innerHTML = generateABCReport();
      break;
    case 'expiring':
      title.textContent = 'Detalhes - Próximos da Validade';
      content.innerHTML = generateExpiringReport();
      break;
    case 'profit-period':
      title.textContent = 'Detalhes - Lucro por Período';
      content.innerHTML = generateProfitReport();
      break;
  }
}

function generateTopSellersReport() {
  const filtered = getFilteredSales();
  const productSales = {};
  filtered.forEach(sale => {
    sale.items.forEach(item => {
      if (!productSales[item.product_id]) productSales[item.product_id] = { name: item.name, qty: 0, revenue: 0 };
      productSales[item.product_id].qty += item.quantity;
      productSales[item.product_id].revenue += item.price * item.quantity;
    });
  });
  const sorted = Object.values(productSales).sort((a, b) => b.qty - a.qty).slice(0, 10);
  if (sorted.length === 0) return '<p class="text-gray-500 dark:text-gray-400">Nenhum orçamento registrado</p>';
  const maxQty = sorted[0].qty;
  return `<div class="space-y-3">${sorted.map((p, i) => `
    <div class="flex items-center gap-3">
      <span class="w-7 h-7 rounded-full bg-accent-100 dark:bg-accent-900/30 text-accent-700 dark:text-accent-400 flex items-center justify-center text-xs font-bold flex-shrink-0">${i+1}</span>
      <div class="flex-1 min-w-0">
        <div class="flex justify-between mb-1"><span class="text-sm font-medium text-gray-900 dark:text-white truncate">${p.name}</span><span class="text-sm font-semibold text-green-600 ml-2">R$ ${p.revenue.toFixed(2)}</span></div>
        <div class="w-full h-2 bg-gray-100 dark:bg-gray-700 rounded-full"><div class="h-2 progress-bar rounded-full" style="width:${(p.qty/maxQty)*100}%"></div></div>
        <p class="text-xs text-gray-500 mt-1">${p.qty} unidades</p>
      </div>
    </div>`).join('')}</div>`;
}

function generateBestMarginReport() {
  const sorted = products
    .map(p => ({ ...p, margin: p.price - p.cost, marginPercent: p.cost > 0 ? ((p.price - p.cost) / p.cost) * 100 : 0 }))
    .sort((a, b) => b.marginPercent - a.marginPercent)
    .slice(0, 10);
  if (sorted.length === 0) return '<p class="text-gray-500 dark:text-gray-400">Nenhum produto cadastrado</p>';
  return `<div class="overflow-x-auto"><table class="w-full"><thead><tr class="border-b border-wine-200 dark:border-wine-700">
    <th class="text-left py-2 text-sm font-medium text-gray-600 dark:text-gray-400">Produto</th>
    <th class="text-right py-2 text-sm font-medium text-gray-600 dark:text-gray-400">Custo</th>
    <th class="text-right py-2 text-sm font-medium text-gray-600 dark:text-gray-400">Venda</th>
    <th class="text-right py-2 text-sm font-medium text-gray-600 dark:text-gray-400">Margem</th>
    </tr></thead><tbody>${sorted.map(p => `<tr class="border-b border-wine-100 dark:border-wine-800">
      <td class="py-3 text-gray-900 dark:text-white">${p.name}</td>
      <td class="py-3 text-right text-gray-600 dark:text-gray-400">${isAdmin() ? `R$ ${p.cost.toFixed(2)}` : '---'}</td>
      <td class="py-3 text-right text-gray-600 dark:text-gray-400">R$ ${p.price.toFixed(2)}</td>
      <td class="py-3 text-right font-bold ${p.marginPercent >= 30 ? 'text-green-600' : p.marginPercent >= 15 ? 'text-amber-600' : 'text-red-600'}">${p.marginPercent.toFixed(0)}%</td>
    </tr>`).join('')}</tbody></table></div>`;
}

function generateLowTurnoverReport() {
  const productSales = {};
  sales.forEach(sale => { sale.items.forEach(item => { productSales[item.product_id] = (productSales[item.product_id] || 0) + item.quantity; }); });
  const lowTurnover = products.filter(p => !productSales[p.id] || productSales[p.id] < 3).map(p => ({ ...p, sold: productSales[p.id] || 0 }));
  if (lowTurnover.length === 0) return '<p class="text-green-600 dark:text-green-400 font-medium">Todos os produtos têm boa rotatividade!</p>';
  const capitalParado = lowTurnover.reduce((sum, p) => sum + (p.cost * p.stock), 0);
  return `<div class="mb-4 p-4 rounded-xl bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800">
    <p class="text-amber-800 dark:text-amber-200 font-medium flex items-center gap-2"><svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg> Capital parado: R$ ${capitalParado.toFixed(2)}</p>
  </div><div class="space-y-2">${lowTurnover.map(p => `<div class="flex items-center justify-between p-3 rounded-lg bg-white/50 dark:bg-gray-800/50"><div><p class="font-medium text-gray-900 dark:text-white">${p.name}</p><p class="text-xs text-gray-500 dark:text-gray-400">${p.stock} un em estoque - ${p.sold} vendidos</p></div><p class="text-sm text-gray-600 dark:text-gray-400">R$ ${(p.cost * p.stock).toFixed(2)}</p></div>`).join('')}</div>`;
}

function generateABCReport() {
  const productRevenue = {};
  sales.forEach(sale => { sale.items.forEach(item => { productRevenue[item.product_id] = (productRevenue[item.product_id] || 0) + (item.price * item.quantity); }); });
  const sorted = Object.entries(productRevenue).map(([id, revenue]) => { const product = products.find(p => p.id === id); return product ? { ...product, revenue } : null; }).filter(Boolean).sort((a, b) => b.revenue - a.revenue);
  if (sorted.length === 0) return '<p class="text-gray-500 dark:text-gray-400">Nenhum orçamento registrado para análise</p>';
  const totalRevenue = sorted.reduce((sum, p) => sum + p.revenue, 0);
  let accumulated = 0;
  const classified = sorted.map(p => { accumulated += p.revenue; const percent = (accumulated / totalRevenue) * 100; return { ...p, percent, classe: percent <= 80 ? 'A' : percent <= 95 ? 'B' : 'C' }; });
  return `<div class="space-y-2">${classified.slice(0, 15).map(p => `<div class="flex items-center gap-3 p-3 rounded-lg bg-white/50 dark:bg-gray-800/50"><span class="w-8 h-8 rounded-full flex items-center justify-center font-bold text-white text-sm ${p.classe === 'A' ? 'bg-green-500' : p.classe === 'B' ? 'bg-amber-500' : 'bg-red-500'}">${p.classe}</span><div class="flex-1 min-w-0"><p class="font-medium text-gray-900 dark:text-white truncate">${p.name}</p></div><p class="font-medium text-gray-600 dark:text-gray-400">R$ ${p.revenue.toFixed(2)}</p></div>`).join('')}</div>`;
}

function generateExpiringReport() {
  const expiringProducts = stockEntries.filter(e => e.expiry).map(e => { const product = products.find(p => p.id === e.product_id); const daysUntil = Math.ceil((new Date(e.expiry) - new Date()) / (1000 * 60 * 60 * 24)); return product ? { ...product, expiry: e.expiry, daysUntil, batch: e.batch } : null; }).filter(p => p && p.daysUntil <= 90).sort((a, b) => a.daysUntil - b.daysUntil);
  if (expiringProducts.length === 0) return '<p class="text-green-600 dark:text-green-400 font-medium">Nenhum produto próximo da validade!</p>';
  return `<div class="space-y-3">${expiringProducts.map(p => {
    const urgency = p.daysUntil <= 30 ? 'bg-red-100 dark:bg-red-900/50 border-red-200 dark:border-red-700' : p.daysUntil <= 60 ? 'bg-amber-100 dark:bg-amber-900/50 border-amber-200 dark:border-amber-700' : 'bg-yellow-100 dark:bg-yellow-900/50 border-yellow-200 dark:border-yellow-700';
    return `<div class="p-4 rounded-xl ${urgency} border"><div class="flex items-center justify-between"><div><p class="font-bold text-gray-900 dark:text-white">${p.name}</p><p class="text-sm text-gray-600 dark:text-gray-400">Lote: ${p.batch || 'N/A'}</p></div><div class="text-right"><p class="font-bold ${p.daysUntil <= 30 ? 'text-red-600' : p.daysUntil <= 60 ? 'text-amber-600' : 'text-yellow-600'}">${p.daysUntil} dias</p><p class="text-xs text-gray-500 dark:text-gray-400">${new Date(p.expiry).toLocaleDateString('pt-BR')}</p></div></div></div>`;
  }).join('')}</div>`;
}

function generateProfitReport() {
  const filtered = getFilteredSales();
  const monthlyData = {};
  filtered.forEach(s => { const date = new Date(s.created_at); const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`; if (!monthlyData[key]) monthlyData[key] = { revenue: 0, profit: 0, count: 0 }; monthlyData[key].revenue += s.total; monthlyData[key].profit += s.profit; monthlyData[key].count++; });
  const sorted = Object.entries(monthlyData).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 12);
  if (sorted.length === 0) return '<p class="text-gray-500 dark:text-gray-400">Nenhum orçamento registrado para análise</p>';
  const maxProfit = Math.max(...sorted.map(([_, d]) => d.profit));
  return `<div class="space-y-4">${sorted.map(([month, data]) => {
    const [year, m] = month.split('-');
    const monthName = new Date(year, m - 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    const barWidth = maxProfit > 0 ? (data.profit / maxProfit) * 100 : 0;
    return `<div><div class="flex items-center justify-between mb-1"><span class="text-sm font-medium text-gray-700 dark:text-gray-300 capitalize">${monthName}</span><span class="text-sm font-bold ${data.profit >= 0 ? 'text-green-600' : 'text-red-600'}">R$ ${data.profit.toFixed(2)}</span></div><div class="w-full h-4 bg-gray-200 dark:bg-gray-700 rounded-full"><div class="h-4 ${data.profit >= 0 ? 'progress-bar' : 'bg-red-500'} rounded-full transition-all" style="width: ${Math.abs(barWidth)}%"></div></div><p class="text-xs text-gray-500 dark:text-gray-400 mt-1">${data.count} orçamentos - Receita: R$ ${data.revenue.toFixed(2)}</p></div>`;
  }).join('')}</div>`;
}

function closeReport() {
  document.getElementById('report-display').classList.add('hidden');
}

// ============================================
// SHIFT SYSTEM - Dual Cash Register Shifts
// ============================================

function getCurrentShift() {
  const now = new Date();
  const currentTime = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
  
  if (currentTime >= shiftConfig.shift1_start && currentTime < shiftConfig.shift1_end) {
    return 'shift1';
  }
  if (shiftConfig.shift2_start <= shiftConfig.shift2_end) {
    if (currentTime >= shiftConfig.shift2_start && currentTime < shiftConfig.shift2_end) {
      return 'shift2';
    }
  } else {
    // Handles overnight shifts (e.g., 22:00 - 06:00)
    if (currentTime >= shiftConfig.shift2_start || currentTime < shiftConfig.shift2_end) {
      return 'shift2';
    }
  }
  // If between shifts, return closest
  return currentTime < shiftConfig.shift1_start ? 'shift1' : 'shift2';
}

function getShiftForTime(dateStr) {
  const d = new Date(dateStr);
  const timeStr = d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
  
  if (timeStr >= shiftConfig.shift1_start && timeStr < shiftConfig.shift1_end) {
    return 'shift1';
  }
  if (shiftConfig.shift2_start <= shiftConfig.shift2_end) {
    if (timeStr >= shiftConfig.shift2_start && timeStr < shiftConfig.shift2_end) {
      return 'shift2';
    }
  } else {
    if (timeStr >= shiftConfig.shift2_start || timeStr < shiftConfig.shift2_end) {
      return 'shift2';
    }
  }
  return timeStr < shiftConfig.shift1_start ? 'shift1' : 'shift2';
}

function updateShiftIndicator() {
  const shift = getCurrentShift();
  const isMorning = shift === 'shift1';
  
  const nameEl = document.getElementById('shift-name');
  const rangeEl = document.getElementById('shift-time-range');
  const iconBox = document.getElementById('shift-icon-box');
  const sunSvg = document.getElementById('shift-svg-sun');
  const moonSvg = document.getElementById('shift-svg-moon');
  
  if (nameEl) nameEl.textContent = isMorning ? shiftConfig.shift1_name : shiftConfig.shift2_name;
  if (rangeEl) rangeEl.textContent = isMorning
    ? `${shiftConfig.shift1_start} - ${shiftConfig.shift1_end}`
    : `${shiftConfig.shift2_start} - ${shiftConfig.shift2_end}`;
  
  if (iconBox) {
    iconBox.className = isMorning ? 'shift-icon shift-icon-morning' : 'shift-icon shift-icon-night';
  }
  if (sunSvg) sunSvg.classList.toggle('hidden', !isMorning);
  if (moonSvg) moonSvg.classList.toggle('hidden', isMorning);
}

function startShiftAutoUpdate() {
  if (shiftUpdateInterval) clearInterval(shiftUpdateInterval);
  updateShiftIndicator();
  shiftUpdateInterval = setInterval(() => {
    updateShiftIndicator();
    // Also update settings page if visible
    if (currentPage === 'settings') refreshSettingsShiftStatus();
  }, 30000); // Check every 30s
}

async function loadShiftConfig() {
  // Try loading from Supabase first (only if app_settings table exists)
  if (supabaseClient && (await isTableAvailable('app_settings'))) {
    try {
      const { data, error } = await supabaseClient
        .from('app_settings')
        .select('*')
        .eq('key', 'shift_config')
        .maybeSingle();
      if (data && !error && data.value) {
        const parsed = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
        Object.assign(shiftConfig, parsed);
      }
    } catch (e) {
      // app_settings table may not exist, localStorage fallback below
    }
  }
  
  // Fallback to localStorage
  const saved = localStorage.getItem('adega_shift_config');
  if (saved) {
    try {
      Object.assign(shiftConfig, JSON.parse(saved));
    } catch (e) {}
  }
  
  startShiftAutoUpdate();
}

async function saveShiftConfig(e) {
  e.preventDefault();
  
  shiftConfig.shift1_name = document.getElementById('shift1-name').value.trim() || 'Manhã';
  shiftConfig.shift1_start = document.getElementById('shift1-start').value || '06:00';
  shiftConfig.shift1_end = document.getElementById('shift1-end').value || '14:00';
  shiftConfig.shift2_name = document.getElementById('shift2-name').value.trim() || 'Noite';
  shiftConfig.shift2_start = document.getElementById('shift2-start').value || '14:00';
  shiftConfig.shift2_end = document.getElementById('shift2-end').value || '23:59';
  
  // Save to localStorage
  localStorage.setItem('adega_shift_config', JSON.stringify(shiftConfig));
  
  // Try saving to Supabase (only if app_settings table exists)
  if (supabaseClient && _tableAvailable['app_settings']) {
    try {
      await supabaseClient
        .from('app_settings')
        .upsert({ key: 'shift_config', value: shiftConfig }, { onConflict: 'key' });
    } catch (e) {
      // app_settings table may not exist, localStorage is primary storage
    }
  }
  
  updateShiftIndicator();
  refreshSettingsPage();
  updateReportShiftLabels();
  showToast('Configurações de turnos salvas!');
}

function refreshSettingsPage() {
  // Fill form fields
  const s1Name = document.getElementById('shift1-name');
  if (s1Name) s1Name.value = shiftConfig.shift1_name;
  const s1Start = document.getElementById('shift1-start');
  if (s1Start) s1Start.value = shiftConfig.shift1_start;
  const s1End = document.getElementById('shift1-end');
  if (s1End) s1End.value = shiftConfig.shift1_end;
  const s2Name = document.getElementById('shift2-name');
  if (s2Name) s2Name.value = shiftConfig.shift2_name;
  const s2Start = document.getElementById('shift2-start');
  if (s2Start) s2Start.value = shiftConfig.shift2_start;
  const s2End = document.getElementById('shift2-end');
  if (s2End) s2End.value = shiftConfig.shift2_end;
  
  // Update preview cards
  const sn1 = document.getElementById('settings-shift1-name');
  if (sn1) sn1.textContent = shiftConfig.shift1_name;
  const sr1 = document.getElementById('settings-shift1-range');
  if (sr1) sr1.textContent = `${shiftConfig.shift1_start} — ${shiftConfig.shift1_end}`;
  const sn2 = document.getElementById('settings-shift2-name');
  if (sn2) sn2.textContent = shiftConfig.shift2_name;
  const sr2 = document.getElementById('settings-shift2-range');
  if (sr2) sr2.textContent = `${shiftConfig.shift2_start} — ${shiftConfig.shift2_end}`;
  
  refreshSettingsShiftStatus();
  updateShiftSummaryToday();
}

function refreshSettingsShiftStatus() {
  const current = getCurrentShift();
  
  const card1 = document.getElementById('settings-shift1-card');
  const card2 = document.getElementById('settings-shift2-card');
  const status1 = document.getElementById('settings-shift1-status');
  const status2 = document.getElementById('settings-shift2-status');
  
  if (card1) {
    card1.className = current === 'shift1'
      ? 'shift-config-card shift-config-active rounded-2xl p-5 border-2 transition-all cursor-default'
      : 'shift-config-card rounded-2xl p-5 border-2 transition-all cursor-default';
  }
  if (card2) {
    card2.className = current === 'shift2'
      ? 'shift-config-card shift-config-active rounded-2xl p-5 border-2 transition-all cursor-default'
      : 'shift-config-card rounded-2xl p-5 border-2 transition-all cursor-default';
  }
  if (status1) {
    status1.className = current === 'shift1' ? 'shift-status-badge shift-status-active' : 'shift-status-badge shift-status-inactive';
    status1.innerHTML = current === 'shift1' ? '<span class="shift-status-dot"></span> Ativo agora' : '<span class="shift-status-dot"></span> Inativo';
  }
  if (status2) {
    status2.className = current === 'shift2' ? 'shift-status-badge shift-status-active' : 'shift-status-badge shift-status-inactive';
    status2.innerHTML = current === 'shift2' ? '<span class="shift-status-dot"></span> Ativo agora' : '<span class="shift-status-dot"></span> Inativo';
  }
}

function updateShiftSummaryToday() {
  const todayStr = new Date().toDateString();
  const todaySales = sales.filter(s => new Date(s.created_at).toDateString() === todayStr);
  
  // Classify sales by shift - use stored shift or infer from time
  const shift1Sales = todaySales.filter(s => (s.shift || getShiftForTime(s.created_at)) === 'shift1');
  const shift2Sales = todaySales.filter(s => (s.shift || getShiftForTime(s.created_at)) === 'shift2');
  
  // Shift 1 stats
  const s1Count = shift1Sales.length;
  const s1Revenue = shift1Sales.reduce((sum, s) => sum + (s.total || 0), 0);
  const s1Profit = shift1Sales.reduce((sum, s) => sum + (s.profit || 0), 0);
  
  const el1Count = document.getElementById('shift1-stat-count');
  const el1Revenue = document.getElementById('shift1-stat-revenue');
  const el1Profit = document.getElementById('shift1-stat-profit');
  if (el1Count) el1Count.textContent = s1Count;
  if (el1Revenue) el1Revenue.textContent = `R$ ${s1Revenue.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  if (el1Profit) el1Profit.textContent = `R$ ${s1Profit.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  
  // Shift 2 stats
  const s2Count = shift2Sales.length;
  const s2Revenue = shift2Sales.reduce((sum, s) => sum + (s.total || 0), 0);
  const s2Profit = shift2Sales.reduce((sum, s) => sum + (s.profit || 0), 0);
  
  const el2Count = document.getElementById('shift2-stat-count');
  const el2Revenue = document.getElementById('shift2-stat-revenue');
  const el2Profit = document.getElementById('shift2-stat-profit');
  if (el2Count) el2Count.textContent = s2Count;
  if (el2Revenue) el2Revenue.textContent = `R$ ${s2Revenue.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  if (el2Profit) el2Profit.textContent = `R$ ${s2Profit.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  
  // Update summary labels
  const sn1 = document.getElementById('shift-summary-name1');
  const sr1 = document.getElementById('shift-summary-range1');
  const sn2 = document.getElementById('shift-summary-name2');
  const sr2 = document.getElementById('shift-summary-range2');
  if (sn1) sn1.textContent = shiftConfig.shift1_name;
  if (sr1) sr1.textContent = `${shiftConfig.shift1_start} — ${shiftConfig.shift1_end}`;
  if (sn2) sn2.textContent = shiftConfig.shift2_name;
  if (sr2) sr2.textContent = `${shiftConfig.shift2_start} — ${shiftConfig.shift2_end}`;
}

function updateReportShiftLabels() {
  const l1 = document.getElementById('rpt-shift1-label');
  const l2 = document.getElementById('rpt-shift2-label');
  if (l1) l1.textContent = shiftConfig.shift1_name;
  if (l2) l2.textContent = shiftConfig.shift2_name;
}

// Initialize - single entry point to avoid duplicate Supabase client instances
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
