/* ============================================================
   我的小店 · 点餐（网页版）
   ------------------------------------------------------------
   存储后端：
   - config.js 填好 Supabase 地址和 anon key → 云端共享
   - 不填 → 自动退回浏览器本地存储，用于离线演示

   顾客：点餐 → 加购物车 → 下单 → 查看自己的订单
   商家：密码进入 → 接单/拒单/完成 → 管理菜单
   初始管理密码：123456（可在「设置」里修改）
   ============================================================ */

const APP_CONFIG = window.APP_CONFIG || {};
const SUPABASE_URL = String(APP_CONFIG.SUPABASE_URL || '').trim().replace(/\/+$/, '');
const SUPABASE_ANON_KEY = String(APP_CONFIG.SUPABASE_ANON_KEY || '').trim();
const SUPABASE_READY = /^https?:\/\//i.test(SUPABASE_URL)
  && SUPABASE_ANON_KEY.length > 30
  && SUPABASE_ANON_KEY.indexOf('请填写') === -1;

const STORAGE = {
  menus: 'dc_menus',
  orders: 'dc_orders',
  config: 'dc_config',
  cart: 'dc_cart',
};

const DEFAULT_CONFIG = { shopName: '我的小店', adminPassword: '123456' };

const SEED_MENUS = [
  { name: '红烧肉', price: 38, category: '热菜', desc: '肥而不腻，入口即化', available: true },
  { name: '宫保鸡丁', price: 28, category: '热菜', desc: '经典川味，微辣', available: true },
  { name: '清炒时蔬', price: 18, category: '热菜', desc: '当季新鲜蔬菜', available: true },
  { name: '米饭', price: 2, category: '主食', desc: '东北大米', available: true },
  { name: '番茄蛋汤', price: 12, category: '汤品', desc: '家常味道', available: true },
  { name: '酸梅汤', price: 8, category: '饮品', desc: '冰镇解腻', available: true },
];

const STATUS_TEXT = {
  pending: '待接单',
  accepted: '已接单',
  completed: '已完成',
  rejected: '已拒单',
};

/* ---------------- 通用工具 ---------------- */
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function money(n) {
  const v = Number(n);
  return (Math.round((isNaN(v) ? 0 : v) * 100) / 100).toFixed(2);
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function makeOrderNo() {
  const d = new Date();
  return 'D' + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate())
    + pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds())
    + Math.floor(1000 + Math.random() * 9000);
}

function fmtTime(ts) {
  const d = new Date(ts);
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
    + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

/* ---------------- 本地存储（无 Supabase 时使用） ---------------- */
function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    /* 隐私模式可能写入失败 */
  }
}

function getMenus() {
  const v = read(STORAGE.menus, null);
  return Array.isArray(v) ? v : [];
}
function setMenus(v) { write(STORAGE.menus, v); }

function getOrders() {
  const v = read(STORAGE.orders, null);
  return Array.isArray(v) ? v : [];
}
function setOrders(v) { write(STORAGE.orders, v); }

function getCart() {
  const v = read(STORAGE.cart, null);
  return Array.isArray(v) ? v : [];
}
function setCart(v) { write(STORAGE.cart, v); }

function getConfig() {
  const c = read(STORAGE.config, null);
  return Object.assign({}, DEFAULT_CONFIG, c && typeof c === 'object' ? c : {});
}
function setConfig(c) { write(STORAGE.config, c); }

function seedMenus() {
  return SEED_MENUS.map(function (m, i) {
    return Object.assign({ id: 'm' + (i + 1), sort: i + 1 }, m);
  });
}

function ensureLocalData() {
  if (!read(STORAGE.menus, null)) setMenus(seedMenus());
  if (!read(STORAGE.config, null)) setConfig(DEFAULT_CONFIG);
  if (!read(STORAGE.orders, null)) setOrders([]);
  if (!read(STORAGE.cart, null)) setCart([]);
}

function getCustomerId() {
  try {
    let id = localStorage.getItem('dc_customer_id');
    if (!id) {
      id = 'c_' + uid();
      localStorage.setItem('dc_customer_id', id);
    }
    return id;
  } catch (e) {
    return 'c_' + uid();
  }
}

/* ---------------- 数据映射（兼容数据库与本地两种字段） ---------------- */
function mapMenu(row) {
  return {
    id: row.id,
    name: row.name,
    price: Number(row.price || 0),
    category: row.category || '其他',
    desc: row.desc != null ? row.desc : (row.description || ''),
    image: row.image || '',
    available: row.available !== false,
    sort: Number(row.sort || 0),
  };
}

function mapOrder(row) {
  return {
    id: row.id,
    orderNo: row.orderNo || row.order_no,
    items: Array.isArray(row.items) ? row.items : [],
    total: Number(row.total || 0),
    tableNo: row.tableNo != null ? row.tableNo : (row.table_no || ''),
    customerName: row.customerName != null ? row.customerName : (row.customer_name || ''),
    remark: row.remark || '',
    status: row.status,
    createdAt: typeof row.createdAt === 'number' ? row.createdAt : (row.created_at ? new Date(row.created_at).getTime() : Date.now()),
  };
}

/* ---------------- Supabase RPC ---------------- */
async function sbRpc(fn, params) {
  const res = await fetch(SUPABASE_URL + '/rest/v1/rpc/' + fn, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: 'Bearer ' + SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(params || {}),
  });
  const text = await res.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch (e) { data = text; }
  }
  if (!res.ok) {
    const msg = (data && (data.message || data.details || data.hint))
      || ('请求失败（' + res.status + '）');
    throw new Error(msg);
  }
  return data;
}

/* ---------------- 后端：本地存储 ---------------- */
function checkLocalPwd(pwd) {
  if (pwd !== getConfig().adminPassword) throw new Error('密码错误');
}

const localBackend = {
  kind: 'local',

  async getShopName() {
    return getConfig().shopName;
  },

  async listMenus() {
    const menus = getMenus();
    if (!menus.length) {
      const seeded = seedMenus();
      setMenus(seeded);
      return seeded;
    }
    return menus;
  },

  async placeOrder(o) {
    const order = {
      id: uid(),
      orderNo: makeOrderNo(),
      items: o.items,
      total: o.total,
      tableNo: o.tableNo,
      customerName: o.customerName,
      remark: o.remark,
      status: 'pending',
      createdAt: Date.now(),
    };
    const orders = getOrders();
    orders.push(order);
    setOrders(orders);
    return order;
  },

  async myOrders() {
    return getOrders();
  },

  async adminLogin(pwd) {
    checkLocalPwd(pwd);
    return getConfig().shopName;
  },

  async adminOrders(pwd, status) {
    checkLocalPwd(pwd);
    const orders = getOrders();
    return status ? orders.filter(function (o) { return o.status === status; }) : orders;
  },

  async adminMenus(pwd) {
    checkLocalPwd(pwd);
    return getMenus();
  },

  async saveMenu(pwd, d) {
    checkLocalPwd(pwd);
    const menus = getMenus();
    if (d.id) {
      const m = menus.filter(function (x) { return x.id === d.id; })[0];
      if (m) {
        m.name = d.name;
        m.price = d.price;
        m.category = d.category;
        m.desc = d.desc;
        m.image = d.image;
        m.available = d.available;
      }
    } else {
      menus.push({
        id: uid(),
        name: d.name,
        price: d.price,
        category: d.category,
        desc: d.desc,
        image: d.image,
        available: d.available,
        sort: menus.length + 1,
      });
    }
    setMenus(menus);
  },

  async toggleMenu(pwd, id) {
    checkLocalPwd(pwd);
    const menus = getMenus();
    const m = menus.filter(function (x) { return x.id === id; })[0];
    if (!m) throw new Error('菜品不存在');
    m.available = m.available === false;
    setMenus(menus);
  },

  async deleteMenu(pwd, id) {
    checkLocalPwd(pwd);
    setMenus(getMenus().filter(function (m) { return m.id !== id; }));
  },

  async updateOrder(pwd, id, status) {
    checkLocalPwd(pwd);
    const orders = getOrders();
    const o = orders.filter(function (x) { return x.id === id; })[0];
    if (!o) throw new Error('订单不存在');
    o.status = status;
    o.updatedAt = Date.now();
    setOrders(orders);
  },

  async saveSettings(pwd, shopName, newPwd) {
    checkLocalPwd(pwd);
    const cfg = getConfig();
    if (shopName) cfg.shopName = shopName;
    if (newPwd) cfg.adminPassword = newPwd;
    setConfig(cfg);
  },

  async resetDemo(pwd) {
    checkLocalPwd(pwd);
    setMenus(seedMenus());
    setOrders([]);
  },
};

/* ---------------- 后端：Supabase ---------------- */
const supabaseBackend = {
  kind: 'supabase',

  async getShopName() {
    const rows = await sbRpc('get_shop');
    return (rows && rows[0] && rows[0].shop_name) || '我的小店';
  },

  async listMenus() {
    return await sbRpc('list_menus');
  },

  async placeOrder(o) {
    const rows = await sbRpc('place_order', {
      p_customer_id: o.customerId,
      p_items: o.items,
      p_total: o.total,
      p_table_no: o.tableNo,
      p_customer_name: o.customerName,
      p_remark: o.remark,
    });
    return rows && rows[0];
  },

  async myOrders(customerId) {
    return await sbRpc('my_orders', { p_customer_id: customerId });
  },

  async adminLogin(pwd) {
    const rows = await sbRpc('admin_login', { p_password: pwd });
    return (rows && rows[0] && rows[0].shop_name) || '我的小店';
  },

  async adminOrders(pwd, status) {
    return await sbRpc('admin_orders', { p_password: pwd, p_status: status || null });
  },

  async adminMenus(pwd) {
    return await sbRpc('admin_menus', { p_password: pwd });
  },

  async saveMenu(pwd, d) {
    await sbRpc('admin_save_menu', {
      p_password: pwd,
      p_id: d.id || null,
      p_name: d.name,
      p_price: d.price,
      p_category: d.category,
      p_description: d.desc,
      p_image: d.image,
      p_available: d.available,
      p_sort: d.sort || 0,
    });
  },

  async toggleMenu(pwd, id) {
    await sbRpc('admin_toggle_menu', { p_password: pwd, p_id: id });
  },

  async deleteMenu(pwd, id) {
    await sbRpc('admin_delete_menu', { p_password: pwd, p_id: id });
  },

  async updateOrder(pwd, id, status) {
    await sbRpc('admin_update_order', { p_password: pwd, p_order_id: id, p_status: status });
  },

  async saveSettings(pwd, shopName, newPwd) {
    await sbRpc('admin_save_settings', {
      p_password: pwd,
      p_shop_name: shopName || null,
      p_new_password: newPwd || null,
    });
  },

  async resetDemo(pwd) {
    await sbRpc('admin_reset_demo', { p_password: pwd });
  },
};

const backend = SUPABASE_READY ? supabaseBackend : localBackend;

/* ---------------- 页面状态 ---------------- */
const state = {
  route: 'menu',
  category: '推荐',
  cart: [],
  cartForm: { tableNo: '', customerName: '', remark: '' },
  adminAuthed: false,
  adminPwd: '',
  adminTab: 'orders',
  orderFilter: 'pending',
  loginPwd: '',
  menuDraft: null,
  shopDraft: undefined,
  pwdDraft: '',
  toastTimer: null,
  loading: true,
  error: '',
  menus: [],
  orders: [],
  shopName: '我的小店',
};

const appEl = document.getElementById('app');
const toastEl = document.getElementById('toast');

/* ---------------- 渲染 ---------------- */
function render() {
  if (state.loading) {
    appEl.innerHTML = '<div class="screen"><div class="loading"><div class="spinner"></div>加载中…</div></div>';
    return;
  }

  let html;
  if (state.route === 'cart') html = viewCart();
  else if (state.route === 'orders') html = viewOrders();
  else if (state.route === 'adminLogin') html = viewAdminLogin();
  else if (state.route === 'admin') html = viewAdmin();
  else html = viewMenu();

  appEl.innerHTML = html + (state.menuDraft ? viewMenuModal() : '');
}

function categoriesOf(menus) {
  const arr = ['推荐'];
  menus.forEach(function (m) {
    if (m.available === false) return;
    const c = m.category || '其他';
    if (arr.indexOf(c) === -1) arr.push(c);
  });
  return arr;
}

/* ---------------- 顾客：点餐 ---------------- */
function viewMenu() {
  const menus = state.menus;
  const cats = categoriesOf(menus);
  if (cats.indexOf(state.category) === -1) state.category = '推荐';

  const visible = menus.filter(function (m) {
    if (m.available === false) return false;
    return state.category === '推荐' || (m.category || '其他') === state.category;
  });

  const count = state.cart.reduce(function (s, i) { return s + i.qty; }, 0);
  const total = state.cart.reduce(function (s, i) { return s + i.price * i.qty; }, 0);

  const dishHtml = visible.length
    ? visible.map(function (m) {
        const thumb = m.image
          ? '<img src="' + esc(m.image) + '" alt="">'
          : '<span>' + esc((m.name || '菜').slice(0, 1)) + '</span>';
        return '' +
          '<article class="dish">' +
            '<div class="dish-thumb">' + thumb + '</div>' +
            '<div class="dish-body">' +
              '<div class="dish-name">' + esc(m.name) + '</div>' +
              '<div class="dish-desc">' + esc(m.desc || '') + '</div>' +
              '<div class="dish-foot">' +
                '<span class="price">¥' + money(m.price) + '</span>' +
                '<button class="add-btn" data-action="add-cart" data-id="' + esc(m.id) + '">＋</button>' +
              '</div>' +
            '</div>' +
          '</article>';
      }).join('')
    : '<div class="empty">这个分类下还没有菜品</div>';

  const modeHtml = backend.kind === 'local'
    ? '<div class="mode-banner">本地演示模式 · 数据不共享</div>'
    : '';

  const errorHtml = state.error
    ? '<section class="card error-card">' +
        '<div class="error-title">数据加载失败</div>' +
        '<div class="muted">' + esc(state.error) + '</div>' +
        '<div class="muted">请确认已在 Supabase 执行 supabase-schema.sql，并在 config.js 填好 Project URL 和 anon key。</div>' +
      '</section>'
    : '';

  return '' +
    '<div class="screen">' +
      '<header class="topbar">' +
        '<div class="brand">' +
          '<div class="logo">' + esc((state.shopName || '店').slice(0, 1)) + '</div>' +
          '<div>' +
            '<div class="shop-name">' + esc(state.shopName) + '</div>' +
            '<div class="shop-sub">扫码点餐 · 堂食自提</div>' +
          '</div>' +
        '</div>' +
        '<div class="topbar-actions">' +
          '<button class="ghost-btn" data-action="go-orders">订单</button>' +
          '<button class="ghost-btn" data-action="open-admin">商家</button>' +
        '</div>' +
      '</header>' +
      modeHtml +
      '<nav class="cats">' +
        cats.map(function (c) {
          return '<button class="cat ' + (state.category === c ? 'active' : '') +
            '" data-action="cat" data-cat="' + esc(c) + '">' + esc(c) + '</button>';
        }).join('') +
      '</nav>' +
      '<main class="menu-list">' + errorHtml + dishHtml + '</main>' +
      '<div class="cartbar">' +
        '<div class="cart-left">' +
          (count ? '<span class="badge">' + count + '</span>' : '<span class="cart-emoji">🛒</span>') +
          '<span class="cart-total">¥' + money(total) + '</span>' +
        '</div>' +
        '<button class="primary" data-action="go-cart"' + (count ? '' : ' disabled') + '>去结算</button>' +
      '</div>' +
    '</div>';
}

/* ---------------- 顾客：购物车 ---------------- */
function viewCart() {
  const items = state.cart;
  const total = items.reduce(function (s, i) { return s + i.price * i.qty; }, 0);

  const listHtml = items.map(function (i) {
    return '' +
      '<div class="cart-row">' +
        '<div>' +
          '<div class="cart-row-name">' + esc(i.name) + '</div>' +
          '<div class="cart-row-price">¥' + money(i.price) + ' / 份</div>' +
        '</div>' +
        '<div class="stepper">' +
          '<button data-action="dec" data-id="' + esc(i.id) + '">－</button>' +
          '<span>' + i.qty + '</span>' +
          '<button data-action="inc" data-id="' + esc(i.id) + '">＋</button>' +
        '</div>' +
      '</div>';
  }).join('');

  return '' +
    '<div class="screen">' +
      '<header class="subbar">' +
        '<button class="icon-btn" data-action="go-menu">‹</button>' +
        '<span>确认订单</span>' +
        '<span class="subbar-right"></span>' +
      '</header>' +
      '<main class="scroll">' +
        (items.length
          ? '<section class="card">' + listHtml + '</section>' +
            '<section class="card form-card">' +
              '<label class="field"><span>桌号</span><input data-field="tableNo" value="' +
                esc(state.cartForm.tableNo) + '" placeholder="如 3 号桌（可留空）"></label>' +
              '<label class="field"><span>称呼</span><input data-field="customerName" value="' +
                esc(state.cartForm.customerName) + '" placeholder="如 王先生（可留空）"></label>' +
              '<label class="field"><span>备注</span><textarea data-field="remark" rows="2" placeholder="口味、忌口等">' +
                esc(state.cartForm.remark) + '</textarea></label>' +
            '</section>'
          : '<div class="empty">购物车还是空的</div>') +
      '</main>' +
      (items.length
        ? '<footer class="submitbar">' +
            '<div class="total-label">合计 <span class="price">¥' + money(total) + '</span></div>' +
            '<button class="primary" data-action="submit-order">提交订单</button>' +
          '</footer>'
        : '') +
    '</div>';
}

/* ---------------- 顾客：我的订单 ---------------- */
function viewOrders() {
  const orders = state.orders.slice().sort(function (a, b) { return b.createdAt - a.createdAt; });
  return '' +
    '<div class="screen">' +
      '<header class="subbar">' +
        '<button class="icon-btn" data-action="go-menu">‹</button>' +
        '<span>我的订单</span>' +
        '<span class="subbar-right"></span>' +
      '</header>' +
      '<main class="scroll">' +
        (orders.length
          ? orders.map(function (o) { return orderCard(o, false); }).join('')
          : '<div class="empty">还没有订单，去点餐吧</div>') +
      '</main>' +
    '</div>';
}

function orderCard(o, admin) {
  const items = (o.items || []).map(function (i) {
    return '<div class="oi"><span>' + esc(i.name) + ' × ' + i.qty + '</span><span>¥' +
      money(i.price * i.qty) + '</span></div>';
  }).join('');

  return '' +
    '<section class="card order-card">' +
      '<div class="order-head">' +
        '<span class="order-no">单号 ' + esc(o.orderNo) + '</span>' +
        '<span class="status status-' + esc(o.status) + '">' + esc(STATUS_TEXT[o.status] || o.status) + '</span>' +
      '</div>' +
      '<div class="order-items">' + items + '</div>' +
      (o.tableNo ? '<div class="meta">桌号：' + esc(o.tableNo) + '</div>' : '') +
      (o.customerName ? '<div class="meta">顾客：' + esc(o.customerName) + '</div>' : '') +
      (o.remark ? '<div class="meta">备注：' + esc(o.remark) + '</div>' : '') +
      '<div class="order-foot">' +
        '<span>' + fmtTime(o.createdAt) + '</span>' +
        '<span class="price">合计 ¥' + money(o.total) + '</span>' +
      '</div>' +
      (admin ? orderActions(o) : '') +
    '</section>';
}

function orderActions(o) {
  if (o.status === 'pending') {
    return '<div class="order-actions">' +
      '<button class="danger" data-action="order-status" data-id="' + esc(o.id) + '" data-status="rejected">拒单</button>' +
      '<button class="primary" data-action="order-status" data-id="' + esc(o.id) + '" data-status="accepted">接单</button>' +
      '</div>';
  }
  if (o.status === 'accepted') {
    return '<div class="order-actions">' +
      '<button class="primary" data-action="order-status" data-id="' + esc(o.id) + '" data-status="completed">完成订单</button>' +
      '</div>';
  }
  return '';
}

/* ---------------- 商家：登录 ---------------- */
function viewAdminLogin() {
  return '' +
    '<div class="screen">' +
      '<header class="subbar">' +
        '<button class="icon-btn" data-action="go-menu">‹</button>' +
        '<span>商家登录</span>' +
        '<span class="subbar-right"></span>' +
      '</header>' +
      '<main class="scroll">' +
        '<div class="login-box">' +
          '<div class="login-title">商家管理</div>' +
          '<div class="login-sub">初始密码 123456，进入后可在「设置」里修改<br>数据保存在 ' +
            (backend.kind === 'supabase' ? 'Supabase 云端' : '当前浏览器本地') + '</div>' +
          '<input class="login-input" type="password" data-field="loginPwd" placeholder="请输入管理密码" value="' +
            esc(state.loginPwd) + '">' +
          '<button class="primary wide" data-action="admin-login">进入管理端</button>' +
        '</div>' +
      '</main>' +
    '</div>';
}

/* ---------------- 商家：中心 ---------------- */
function viewAdmin() {
  const tab = state.adminTab;
  const body = tab === 'orders' ? adminOrders() : tab === 'menu' ? adminMenu() : adminSettings();
  return '' +
    '<div class="screen">' +
      '<header class="subbar">' +
        '<button class="icon-btn" data-action="exit-admin">‹</button>' +
        '<span>商家中心</span>' +
        '<span class="subbar-right"></span>' +
      '</header>' +
      '<nav class="admin-tabs">' +
        '<button class="' + (tab === 'orders' ? 'active' : '') + '" data-action="admin-tab" data-tab="orders">订单管理</button>' +
        '<button class="' + (tab === 'menu' ? 'active' : '') + '" data-action="admin-tab" data-tab="menu">菜单管理</button>' +
        '<button class="' + (tab === 'settings' ? 'active' : '') + '" data-action="admin-tab" data-tab="settings">设置</button>' +
      '</nav>' +
      '<main class="scroll">' + body + '</main>' +
    '</div>';
}

function adminOrders() {
  const filters = [['pending', '待接单'], ['accepted', '已接单'], ['completed', '已完成'], ['rejected', '已拒单']];
  const all = state.orders;
  const list = all.filter(function (o) { return o.status === state.orderFilter; })
    .sort(function (a, b) { return b.createdAt - a.createdAt; });

  const chips = filters.map(function (f) {
    const n = all.filter(function (o) { return o.status === f[0]; }).length;
    return '<button class="chip ' + (state.orderFilter === f[0] ? 'active' : '') +
      '" data-action="order-filter" data-filter="' + f[0] + '">' + f[1] + (n ? ' ' + n : '') + '</button>';
  }).join('');

  const current = filters.filter(function (f) { return f[0] === state.orderFilter; })[0];

  return '<div class="filter-row">' + chips + '</div>' +
    (list.length
      ? list.map(function (o) { return orderCard(o, true); }).join('')
      : '<div class="empty">暂无' + (current ? current[1] : '') + '订单</div>');
}

function adminMenu() {
  const menus = state.menus.slice().sort(function (a, b) { return (a.sort || 0) - (b.sort || 0); });
  const rows = menus.map(function (m) {
    const thumb = m.image
      ? '<img src="' + esc(m.image) + '" alt="">'
      : '<span>' + esc((m.name || '菜').slice(0, 1)) + '</span>';
    return '' +
      '<section class="card menu-admin-row">' +
        '<div class="dish-thumb small">' + thumb + '</div>' +
        '<div class="dish-body">' +
          '<div class="dish-name">' + esc(m.name) +
            (m.available === false ? '<span class="off">已下架</span>' : '') + '</div>' +
          '<div class="dish-desc">' + esc(m.category || '其他') + ' · ¥' + money(m.price) + '</div>' +
          '<div class="row-actions">' +
            '<button class="link" data-action="menu-toggle" data-id="' + esc(m.id) + '">' +
              (m.available === false ? '上架' : '下架') + '</button>' +
            '<button class="link" data-action="menu-edit" data-id="' + esc(m.id) + '">编辑</button>' +
            '<button class="link danger" data-action="menu-delete" data-id="' + esc(m.id) + '">删除</button>' +
          '</div>' +
        '</div>' +
      '</section>';
  }).join('');

  return '' +
    '<div class="admin-menu-head">' +
      '<span class="muted">共 ' + menus.length + ' 道菜</span>' +
      '<button class="primary small" data-action="menu-add">＋ 添加菜品</button>' +
    '</div>' +
    (menus.length ? rows : '<div class="empty">还没有菜品，点上方添加</div>');
}

function adminSettings() {
  const shopVal = state.shopDraft === undefined ? state.shopName : state.shopDraft;
  return '' +
    '<section class="card form-card">' +
      '<label class="field"><span>店名</span><input data-field="shopName" value="' + esc(shopVal) +
        '" placeholder="我的小店"></label>' +
      '<label class="field"><span>新密码</span><input type="password" data-field="newPwd" value="' +
        esc(state.pwdDraft) + '" placeholder="留空则不修改"></label>' +
      '<button class="primary wide" data-action="save-settings">保存设置</button>' +
    '</section>' +
    '<section class="card">' +
      '<div class="muted" style="margin-bottom:10px;">当前数据存储：' +
        (backend.kind === 'supabase' ? 'Supabase 云端（多设备共享）' : '浏览器本地（仅本机）') + '</div>' +
      '<button class="danger wide" data-action="reset-demo">重置为示例菜单（会清空订单）</button>' +
      '<button class="ghost wide" style="margin-top:10px;" data-action="logout">退出商家登录</button>' +
    '</section>';
}

/* ---------------- 菜品编辑弹窗 ---------------- */
function viewMenuModal() {
  const d = state.menuDraft;
  return '' +
    '<div class="modal-mask" data-action="menu-cancel">' +
      '<div class="modal">' +
        '<div class="modal-title">' + (d.id ? '编辑菜品' : '添加菜品') + '</div>' +
        '<label class="field"><span>名称</span><input data-field="m_name" value="' + esc(d.name) +
          '" placeholder="如 红烧肉"></label>' +
        '<label class="field"><span>价格</span><input type="number" step="0.01" data-field="m_price" value="' +
          esc(d.price) + '" placeholder="如 28"></label>' +
        '<label class="field"><span>分类</span><input data-field="m_category" value="' + esc(d.category) +
          '" placeholder="热菜 / 主食 / 饮品"></label>' +
        '<label class="field"><span>简介</span><input data-field="m_desc" value="' + esc(d.desc) +
          '" placeholder="一句话介绍（可留空）"></label>' +
        '<label class="field"><span>图片</span><input data-field="m_image" value="' + esc(d.image) +
          '" placeholder="图片网址（可留空）"></label>' +
        '<label class="switch-row"><span>上架销售</span><input type="checkbox" data-field="m_available"' +
          (d.available === false ? '' : ' checked') + '></label>' +
        '<div class="modal-actions">' +
          '<button class="ghost" data-action="menu-cancel">取消</button>' +
          '<button class="primary" data-action="menu-save">保存</button>' +
        '</div>' +
      '</div>' +
    '</div>';
}

/* ---------------- 数据加载 ---------------- */
async function loadRouteData() {
  state.error = '';

  if (state.route === 'menu') {
    state.shopName = await backend.getShopName();
    state.menus = (await backend.listMenus()).map(mapMenu);
  } else if (state.route === 'orders') {
    const rows = await backend.myOrders(getCustomerId());
    state.orders = rows.map(mapOrder);
  } else if (state.route === 'admin') {
    if (state.adminTab === 'orders') {
      const rows = await backend.adminOrders(state.adminPwd, null);
      state.orders = rows.map(mapOrder);
    } else if (state.adminTab === 'menu') {
      const rows = await backend.adminMenus(state.adminPwd);
      state.menus = rows.map(mapMenu);
    }
  }
}

async function boot() {
  state.loading = true;
  render();
  try {
    await loadRouteData();
  } catch (e) {
    state.error = e.message || '加载失败';
  }
  state.loading = false;
  render();
}

async function gotoRoute(route) {
  state.route = route;
  state.loading = true;
  render();
  try {
    await loadRouteData();
  } catch (e) {
    state.loading = false;
    render();
    toast(e.message || '加载失败');
    return;
  }
  state.loading = false;
  render();
}

async function perform(task, opts) {
  opts = opts || {};
  state.loading = true;
  render();
  try {
    await task();
    if (opts.reload !== false) await loadRouteData();
    state.loading = false;
    render();
    if (opts.toast) toast(opts.toast);
    return true;
  } catch (e) {
    state.loading = false;
    render();
    toast(e.message || opts.error || '操作失败');
    return false;
  }
}

async function refreshSilently() {
  try {
    await loadRouteData();
    render();
  } catch (e) {
    /* 静默失败，保留旧数据 */
  }
}

/* ---------------- 交互 ---------------- */
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(function () {
    toastEl.classList.remove('show');
  }, 1800);
}

appEl.addEventListener('click', function (e) {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  if (el.classList.contains('modal-mask') && e.target.closest('.modal')) return;
  handleAction(el.getAttribute('data-action'), el.dataset);
});

function onFieldInput(e) {
  const t = e.target;
  const field = t.getAttribute && t.getAttribute('data-field');
  if (!field) return;

  if (field === 'tableNo' || field === 'customerName' || field === 'remark') {
    state.cartForm[field] = t.value;
  } else if (field === 'loginPwd') {
    state.loginPwd = t.value;
  } else if (field === 'shopName') {
    state.shopDraft = t.value;
  } else if (field === 'newPwd') {
    state.pwdDraft = t.value;
  } else if (field.indexOf('m_') === 0 && state.menuDraft) {
    const key = field.slice(2);
    if (key === 'available') state.menuDraft.available = t.checked;
    else state.menuDraft[key] = t.value;
  }
}

appEl.addEventListener('input', onFieldInput);
appEl.addEventListener('change', onFieldInput);

async function handleAction(action, ds) {
  try {
    switch (action) {
      case 'go-menu':
        state.route = 'menu';
        render();
        refreshSilently();
        break;
      case 'go-orders':
        await gotoRoute('orders');
        break;
      case 'go-cart':
        if (state.cart.length) {
          state.route = 'cart';
          render();
        }
        break;
      case 'cat':
        state.category = ds.cat;
        render();
        break;
      case 'add-cart':
        addToCart(ds.id);
        break;
      case 'inc':
        changeQty(ds.id, 1);
        break;
      case 'dec':
        changeQty(ds.id, -1);
        break;
      case 'submit-order':
        await submitOrder();
        break;
      case 'open-admin':
        if (state.adminAuthed) await gotoRoute('admin');
        else { state.route = 'adminLogin'; render(); }
        break;
      case 'admin-login':
        await doAdminLogin();
        break;
      case 'exit-admin':
        state.route = 'menu';
        render();
        refreshSilently();
        break;
      case 'logout':
        state.adminAuthed = false;
        state.adminPwd = '';
        state.route = 'menu';
        render();
        refreshSilently();
        toast('已退出商家登录');
        break;
      case 'admin-tab':
        state.adminTab = ds.tab;
        await gotoRoute('admin');
        break;
      case 'order-filter':
        state.orderFilter = ds.filter;
        render();
        break;
      case 'order-status':
        await updateOrderStatus(ds.id, ds.status);
        break;
      case 'menu-add':
        state.menuDraft = { id: '', name: '', price: '', category: '', desc: '', image: '', available: true };
        render();
        break;
      case 'menu-edit':
        openMenuEditor(ds.id);
        break;
      case 'menu-toggle':
        await perform(function () {
          return backend.toggleMenu(state.adminPwd, ds.id);
        }, { reload: true });
        break;
      case 'menu-delete':
        await deleteMenu(ds.id);
        break;
      case 'menu-cancel':
        state.menuDraft = null;
        render();
        break;
      case 'menu-save':
        await saveMenuDraft();
        break;
      case 'save-settings':
        await saveSettings();
        break;
      case 'reset-demo':
        await resetDemo();
        break;
      default:
        break;
    }
  } catch (e) {
    state.loading = false;
    render();
    toast(e.message || '操作失败');
  }
}

/* ---------------- 业务逻辑 ---------------- */
function addToCart(id) {
  const menu = state.menus.filter(function (m) { return m.id === id; })[0];
  if (!menu) return;
  const item = state.cart.filter(function (i) { return i.id === id; })[0];
  if (item) item.qty += 1;
  else state.cart.push({ id: id, name: menu.name, price: menu.price, qty: 1 });
  setCart(state.cart);
  render();
  toast('已加入购物车');
}

function changeQty(id, delta) {
  const item = state.cart.filter(function (i) { return i.id === id; })[0];
  if (!item) return;
  item.qty += delta;
  if (item.qty <= 0) {
    state.cart = state.cart.filter(function (i) { return i.id !== id; });
  }
  setCart(state.cart);
  render();
}

async function submitOrder() {
  if (!state.cart.length) return;
  const items = state.cart.map(function (i) {
    return { name: i.name, price: i.price, qty: i.qty };
  });
  const total = items.reduce(function (s, i) { return s + i.price * i.qty; }, 0);

  await perform(async function () {
    await backend.placeOrder({
      customerId: getCustomerId(),
      items: items,
      total: Math.round(total * 100) / 100,
      tableNo: state.cartForm.tableNo.trim(),
      customerName: state.cartForm.customerName.trim(),
      remark: state.cartForm.remark.trim(),
    });
    state.cart = [];
    setCart([]);
    state.cartForm = { tableNo: '', customerName: '', remark: '' };
    state.route = 'orders';
  }, { reload: true, toast: '下单成功，等待商家接单' });
}

async function doAdminLogin() {
  const pwd = String(state.loginPwd || '');
  if (!pwd) {
    toast('请输入密码');
    return;
  }
  state.loading = true;
  render();
  try {
    const shop = await backend.adminLogin(pwd);
    state.adminAuthed = true;
    state.adminPwd = pwd;
    state.shopName = shop || state.shopName;
    state.loginPwd = '';
    state.adminTab = 'orders';
    state.orderFilter = 'pending';
    state.route = 'admin';
    await loadRouteData();
    state.loading = false;
    render();
    toast('欢迎回来');
  } catch (e) {
    state.loading = false;
    render();
    toast(e.message || '登录失败');
  }
}

async function updateOrderStatus(id, status) {
  await perform(function () {
    return backend.updateOrder(state.adminPwd, id, status);
  }, { reload: true, toast: STATUS_TEXT[status] || '已更新' });
}

function openMenuEditor(id) {
  const m = state.menus.filter(function (x) { return x.id === id; })[0];
  if (!m) return;
  state.menuDraft = {
    id: m.id,
    name: m.name || '',
    price: m.price == null ? '' : String(m.price),
    category: m.category || '',
    desc: m.desc || '',
    image: m.image || '',
    available: m.available !== false,
  };
  render();
}

async function deleteMenu(id) {
  if (!window.confirm('确定删除这道菜吗？删除后不可恢复。')) return;
  await perform(function () {
    return backend.deleteMenu(state.adminPwd, id);
  }, { reload: true, toast: '已删除' });
}

async function saveMenuDraft() {
  const d = state.menuDraft;
  if (!d) return;
  const name = String(d.name || '').trim();
  const price = Number(d.price);
  if (!name) { toast('请填写菜品名称'); return; }
  if (!price || isNaN(price) || price <= 0) { toast('请填写正确的价格'); return; }

  await perform(async function () {
    await backend.saveMenu(state.adminPwd, {
      id: d.id || null,
      name: name,
      price: Math.round(price * 100) / 100,
      category: String(d.category || '其他').trim() || '其他',
      desc: String(d.desc || '').trim(),
      image: String(d.image || '').trim(),
      available: d.available !== false,
      sort: 0,
    });
    state.menuDraft = null;
  }, { reload: true, toast: '已保存' });
}

async function saveSettings() {
  const shopName = state.shopDraft === undefined ? state.shopName : String(state.shopDraft).trim();
  const newPwd = String(state.pwdDraft || '').trim();
  if (newPwd && newPwd.length < 4) { toast('密码至少 4 位'); return; }

  await perform(async function () {
    await backend.saveSettings(state.adminPwd, shopName || null, newPwd || null);
    if (shopName) state.shopName = shopName;
    if (newPwd) state.adminPwd = newPwd;
    state.shopDraft = undefined;
    state.pwdDraft = '';
  }, { reload: true, toast: '设置已保存' });
}

async function resetDemo() {
  if (!window.confirm('重置会清空所有订单，并把菜单恢复成示例菜品，确定吗？')) return;
  await perform(function () {
    return backend.resetDemo(state.adminPwd);
  }, { reload: true, toast: '已重置为示例数据' });
}

/* ---------------- 启动 ---------------- */
if (!SUPABASE_READY) ensureLocalData();
state.cart = getCart();
boot();
