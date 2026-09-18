/**
 * 主题适配：把 whistle 的 CSS 变量同步到插件页面（iframe）里。
 *
 * 背景：插件页面在 iframe 中，父窗口的 CSS 变量不会继承进来，
 * 因此页面里 `var(--b-default, #fff)` 之类的引用永远取不到值（一直走 fallback，导致深色下仍是浅色）。
 *
 * 做法（方案 A）：
 *   1. 同源前提下读取父窗口 computedStyle 上的 whistle 变量，注入到本页 documentElement 的行内样式
 *   2. 镜像 `data-theme` 与 `color-scheme`，并覆盖 whistle 注入的 `html{background:#fff}`
 *   3. 监听父窗口 html 属性变化（+ 定时兜底），切换主题实时生效
 *   4. 取不到父窗口时（单独打开/跨域）回退到内置的浅/深两套调色板（配合 prefers-color-scheme）
 */
(function (root, factory) {
  var mod = factory();
  if (typeof module === 'object' && module && module.exports) {
    module.exports = mod;
  }
  if (root && typeof root === 'object') {
    root.SseTheme = mod;
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 需要同步的 whistle 变量（都是 whistle 自身在 :root 中使用的名字）
  var VAR_LIST = [
    '--b-default',
    '--b-bar',
    '--b-title',
    '--b-hover',
    '--b-active',
    '--b-heavy',
    '--b-btn-hover',
    '--b-primary',
    '--b-modal',
    '--b-success',
    '--b-error',
    '--b-warn',
    '--c-default',
    '--c-thin',
    '--c-heavy',
    '--c-disabled',
    '--c-link',
    '--c-border',
    '--c-btn',
    '--c-ok',
    '--c-error',
    '--c-warn',
    '--v-border',
    '--h-field',
    '--z-modal'
  ];

  var COLOR_SCHEME = 'color-scheme';

  // 兜底调色板：取自 whistle 的浅色 / 深色 :root（父窗口不可访问时使用）
  var FALLBACK = {
    light: {
      '--b-default': '#fff',
      '--b-bar': '#fafafa',
      '--b-title': '#f1f3f4',
      '--b-hover': '#f5f5f5',
      '--b-active': '#ddd',
      '--b-heavy': '#eee',
      '--b-btn-hover': '#e6e6e6',
      '--b-primary': '#337ab7',
      '--b-modal': 'rgba(0,0,0,.5)',
      '--b-success': '#dff0d8',
      '--b-error': '#f2dede',
      '--b-warn': '#fffbe6',
      '--c-default': '#000',
      '--c-thin': '#555',
      '--c-heavy': '#333',
      '--c-disabled': '#aaa',
      '--c-link': '#337ab7',
      '--c-border': '#ccc',
      '--c-btn': '#fff',
      '--c-ok': '#5bbd72',
      '--c-error': 'red',
      '--c-warn': '#5c3b00',
      '--v-border': '1px solid #ccc',
      '--h-field': '2pc',
      '--z-modal': '1051',
      'color-scheme': 'light'
    },
    dark: {
      '--b-default': '#1a1a1a',
      '--b-bar': '#212121',
      '--b-title': '#222427',
      '--b-hover': '#333',
      '--b-active': '#3f3f3f',
      '--b-heavy': '#333',
      '--b-btn-hover': '#333',
      '--b-primary': '#0d3a6b',
      '--b-modal': 'rgba(0,0,0,.7)',
      '--b-success': '#1e3c21',
      '--b-error': '#3a2222',
      '--b-warn': '#332e22',
      '--c-default': '#f0f0f0',
      '--c-thin': '#ccc',
      '--c-heavy': '#ddd',
      '--c-disabled': '#666',
      '--c-link': '#4a9fe3',
      '--c-border': '#444',
      '--c-btn': '#eee',
      '--c-ok': '#70d485',
      '--c-error': '#ff6b6b',
      '--c-warn': '#fc4',
      '--v-border': '1px solid #444',
      '--h-field': '2pc',
      '--z-modal': '1051',
      'color-scheme': 'dark'
    }
  };

  function getDocument(win) {
    return win && win.document ? win.document : null;
  }

  function getParentWindow(win) {
    try {
      if (win && win.parent && win.parent !== win) {
        return win.parent;
      }
    } catch (e) {
      /* 跨域时访问 win.parent 本身一般不会抛，读取其 document 才会 */
    }
    return null;
  }

  function normalizeTheme(value) {
    return value === 'dark' ? 'dark' : value === 'light' ? 'light' : '';
  }

  // 读取父窗口（whistle UI）上的主题变量；不可用时返回 null
  function readFromParent(parentWin) {
    try {
      var doc = getDocument(parentWin);
      var rootEl = doc && doc.documentElement;
      if (!rootEl || typeof parentWin.getComputedStyle !== 'function') {
        return null;
      }
      var computed = parentWin.getComputedStyle(rootEl);
      if (!computed || typeof computed.getPropertyValue !== 'function') {
        return null;
      }
      var vars = {};
      var count = 0;
      VAR_LIST.forEach(function (name) {
        var value = computed.getPropertyValue(name);
        value = value == null ? '' : String(value).trim();
        if (value) {
          vars[name] = value;
          count++;
        }
      });
      // whistle 的变量一个都没取到，说明不是我们预期的宿主页面
      if (count < 3) {
        return null;
      }
      var theme = normalizeTheme(rootEl.getAttribute && rootEl.getAttribute('data-theme'));
      if (!theme) {
        theme = vars['--b-default'] === FALLBACK.dark['--b-default'] ? 'dark' : 'light';
      }
      var scheme = computed.getPropertyValue(COLOR_SCHEME);
      return {
        vars: vars,
        theme: theme,
        colorScheme: (scheme || '').trim() || (theme === 'dark' ? 'dark' : 'light')
      };
    } catch (e) {
      return null;
    }
  }

  // 浏览器偏好（父窗口不可用时的主题来源）
  function detectPreferredTheme(win) {
    try {
      if (win && typeof win.matchMedia === 'function') {
        return win.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      }
    } catch (e) {
      /* 忽略 */
    }
    return 'light';
  }

  function getFallback(theme) {
    var palette = theme === 'dark' ? FALLBACK.dark : FALLBACK.light;
    var vars = {};
    Object.keys(palette).forEach(function (name) {
      vars[name] = palette[name];
    });
    return { vars: vars, theme: theme, colorScheme: vars[COLOR_SCHEME] };
  }

  // 把变量写到目标文档的 documentElement 上
  function apply(doc, data) {
    var rootEl = doc && doc.documentElement;
    if (!rootEl) {
      return false;
    }
    var style = rootEl.style || {};
    Object.keys(data.vars).forEach(function (name) {
      if (name === COLOR_SCHEME) {
        return;
      }
      if (typeof style.setProperty === 'function') {
        style.setProperty(name, data.vars[name]);
      }
    });
    if (data.colorScheme && typeof style.setProperty === 'function') {
      style.setProperty(COLOR_SCHEME, data.colorScheme);
    }
    // 覆盖 whistle 注入的 html{background:#fff}，保持与宿主底色一致
    if (data.vars['--b-default']) {
      style.backgroundColor = data.vars['--b-default'];
    }
    if (rootEl.setAttribute) {
      rootEl.setAttribute('data-theme', data.theme === 'dark' ? 'dark' : 'light');
    }
    return true;
  }

  function signature(data) {
    return (
      data.theme +
      '|' +
      data.colorScheme +
      '|' +
      VAR_LIST.map(function (name) {
        return data.vars[name] || '';
      }).join(',')
    );
  }

  /**
   * 同步一次主题
   * @returns {{theme:string, source:'parent'|'fallback', vars:object, changed:boolean}}
   */
  function sync(win, state) {
    win = win || (typeof window !== 'undefined' ? window : null);
    var current = state || {};
    var fromParent = readFromParent(getParentWindow(win));
    var data = fromParent || getFallback(detectPreferredTheme(win));
    var source = fromParent ? 'parent' : 'fallback';
    var changed = current.signature !== signature(data);
    current.vars = data.vars;
    current.theme = data.theme;
    current.colorScheme = data.colorScheme;
    current.source = source;
    current.signature = signature(data);
    apply(getDocument(win), data);
    return { theme: data.theme, source: source, vars: data.vars, changed: changed };
  }

  /**
   * 持续跟随宿主主题变化：MutationObserver（父窗口 html 的 data-theme/class/style）+ 定时兜底
   * @returns {function} 停止监听
   */
  function watch(win, onThemeChange, intervalMs) {
    win = win || (typeof window !== 'undefined' ? window : null);
    var state = {};
    var timer = null;
    var observer = null;

    function tick(forceNotify) {
      var result = sync(win, state);
      if (forceNotify || result.changed) {
        if (typeof onThemeChange === 'function') {
          onThemeChange(result);
        }
      }
      return result;
    }

    var parentWin = getParentWindow(win);
    var parentRoot = null;
    var Observer = null;
    try {
      parentRoot = getDocument(parentWin) && getDocument(parentWin).documentElement;
      Observer = (win && win.MutationObserver) || (parentWin && parentWin.MutationObserver) || null;
    } catch (e) {
      parentRoot = null;
      Observer = null;
    }
    if (Observer && parentRoot) {
      try {
        observer = new Observer(function () {
          tick(false);
        });
        observer.observe(parentRoot, {
          attributes: true,
          attributeFilter: ['data-theme', 'class', 'style']
        });
      } catch (e) {
        observer = null;
      }
    }

    // 兄弟窗口（同源）切换主题时也同步一次；定时轮询作为最终兜底
    try {
      win.addEventListener('storage', function () {
        tick(false);
      });
    } catch (e) {
      /* 忽略 */
    }

    timer = setInterval(function () {
      tick(false);
    }, intervalMs > 0 ? intervalMs : 1000);

    tick(true); // 立即同步一次

    return function stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      if (observer) {
        try {
          observer.disconnect();
        } catch (e) {
          /* 忽略 */
        }
        observer = null;
      }
    };
  }

  function getVar(name, fallback) {
    try {
      var value = window.getComputedStyle(document.documentElement).getPropertyValue(name);
      value = value ? String(value).trim() : '';
      return value || fallback || '';
    } catch (e) {
      return fallback || '';
    }
  }

  return {
    VAR_LIST: VAR_LIST,
    FALLBACK: FALLBACK,
    readFromParent: readFromParent,
    detectPreferredTheme: detectPreferredTheme,
    getFallback: getFallback,
    apply: apply,
    sync: sync,
    watch: watch,
    getVar: getVar
  };
});
