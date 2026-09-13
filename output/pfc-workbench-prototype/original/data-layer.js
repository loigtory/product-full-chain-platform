(() => {
  'use strict';
  /* =====================================================================
   * PFC 数据层适配器（M1 前端先行 · 第一步）
   * 三模式：local（浏览器本地存储，默认，等价原型基线）/ mock（同步内存态模拟服务端）/ api（真实服务端，M1 后段启用）
   * 接口与 localStorage 同构：{ getItem, setItem, removeItem }，
   * model.js 只通过 PFCStore.active() 访问存储，交互层零改动。
   * 模式选择：页面加载前设 window.PFC_DATA_MODE = 'mock' | 'api' | 'local'；
   * 运行时用 PFCStore.cycle()（header 徽标点击）循环切换并重载。
   * ===================================================================== */
  const MOCK_KEY = 'pfc.prototype.mock.v1';

  /* local：直通浏览器 localStorage（原型基线行为，回归等价） */
  const localStore = {
    getItem: (k) => {
      try {
        return localStorage.getItem(k);
      } catch {
        return null;
      }
    },
    setItem: (k, v) => {
      try {
        localStorage.setItem(k, v);
      } catch {
        /* 配额/隐私模式：model.js 已有 storageError 兜底 */
      }
    },
    removeItem: (k) => {
      try {
        localStorage.removeItem(k);
      } catch {
        /* ignore */
      }
    },
  };

  /* mock：同步内存态模拟"服务端"，可选持久化到独立 key（默认开，刷新保留）
   * 与 local 的关键差异：写 P.KEY 时落到 pfc.prototype.mock.v1，
   * 不污染原型基线 key，两个模式的数据互不干扰。 */
  const mockMem = new Map();
  const mockPersist = () => {
    try {
      return window.PFC_MOCK_PERSIST !== false;
    } catch {
      return true;
    }
  };
  const mockStore = {
    getItem: (k) => {
      if (mockMem.has(k)) return mockMem.get(k);
      if (mockPersist()) {
        try {
          const v = localStorage.getItem(MOCK_KEY);
          if (v != null) {
            mockMem.set(k, v);
            return v;
          }
        } catch {
          /* ignore */
        }
      }
      return null;
    },
    setItem: (k, v) => {
      mockMem.set(k, v);
      if (mockPersist()) {
        try {
          localStorage.setItem(MOCK_KEY, v);
        } catch {
          /* ignore */
        }
      }
    },
    removeItem: (k) => {
      mockMem.delete(k);
      if (mockPersist()) {
        try {
          localStorage.removeItem(MOCK_KEY);
        } catch {
          /* ignore */
        }
      }
    },
  };

  /* api：真实服务端桥接（M1 后段启用，后端就绪后）。
   * 同步表面 = 内存镜像 + 变更队列（PFCAPI.api），UI 保持同步；
   * 首次加载与增量提交在 14 号文档说明，本期仅验证桥接骨架与契约映射。 */
  const apiStore = {
    getItem: (k) => {
      try {
        return window.PFCAPI && window.PFCAPI.api
          ? window.PFCAPI.api.getSync(k)
          : null;
      } catch {
        return null;
      }
    },
    setItem: (k, v) => {
      try {
        if (window.PFCAPI && window.PFCAPI.api)
          window.PFCAPI.api.setSync(k, v);
      } catch {
        /* ignore */
      }
    },
    removeItem: (k) => {
      try {
        if (window.PFCAPI && window.PFCAPI.api)
          window.PFCAPI.api.removeSync(k);
      } catch {
        /* ignore */
      }
    },
  };

  const modes = { local: localStore, mock: mockStore, api: apiStore };
  const MODE_KEY = 'pfc.prototype.dataMode';
  let mode = (() => {
    if (window.PFC_LOCAL_PERSONAL) return 'api';
    let m = '';
    try {
      m = window.PFC_DATA_MODE || '';
    } catch {
      /* ignore */
    }
    if (m === 'mock' || m === 'api') return m; // 页面级显式指定优先
    try {
      const saved = localStorage.getItem(MODE_KEY);
      if (saved === 'mock' || saved === 'api') return saved; // 上次选择持久化
    } catch {
      /* ignore */
    }
    return 'local';
  })();

  window.PFCStore = {
    get mode() {
      return mode;
    }, // 动态读取闭包模式（setMode/cycle 后即时反映）
    active: () => modes[mode],
    setMode: (m) => {
      if (window.PFC_LOCAL_PERSONAL) return;
      if (modes[m]) {
        mode = m;
        try {
          localStorage.setItem(MODE_KEY, m);
        } catch {
          /* ignore */
        }
      }
    },
    cycle: () => {
      if (window.PFC_LOCAL_PERSONAL) return 'api';
      const order = ['local', 'mock', 'api'];
      mode = order[(order.indexOf(mode) + 1) % order.length];
      try {
        localStorage.setItem(MODE_KEY, mode);
      } catch {
        /* ignore */
      }
      return mode;
    },
    label: () =>
      ({ local: '本地存储', mock: 'Mock 服务端', api: 'API 模式' })[mode],
    MOCK_KEY,
    MODE_KEY,
  };
})();
