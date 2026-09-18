/**
 * public/theme.js 测试（方案 A：读取宿主 whistle 的 CSS 变量注入插件页）
 *
 *   node test/theme.test.js
 */

const assert = require('assert');
const path = require('path');

const Theme = require(path.join(__dirname, '..', 'public', 'theme.js'));

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log('  ✓ ' + name);
  } catch (err) {
    console.error('  ✗ ' + name);
    console.error('    ' + (err && err.message));
    process.exitCode = 1;
  }
}

function createOwnDocument() {
  const props = {};
  const attrs = {};
  return {
    _props: props,
    _attrs: attrs,
    documentElement: {
      style: {
        setProperty(name, value) {
          props[name] = value;
        },
        // apply() 会直接赋值 backgroundColor
        backgroundColor: ''
      },
      getAttribute: (name) => (name in attrs ? attrs[name] : null),
      setAttribute(name, value) {
        attrs[name] = value;
      }
    }
  };
}

function createParentWindow(opts) {
  const options = opts || {};
  const vars = options.vars || {};
  const doc = {
    documentElement: {
      getAttribute: (name) => (name === 'data-theme' ? options.theme || null : null)
    }
  };
  return {
    document: doc,
    getComputedStyle: () => ({
      getPropertyValue: (name) => (name in vars ? vars[name] : '')
    })
  };
}

function createWindow(opts) {
  const options = opts || {};
  const win = {
    document: options.document || createOwnDocument(),
    parent: options.parent === undefined ? null : options.parent,
    matchMedia: () => ({ matches: !!options.prefersDark }),
    addEventListener: () => {},
    MutationObserver: options.Observer
  };
  return win;
}

const WHISTLE_DARK = {
  '--b-default': '#1a1a1a',
  '--b-bar': '#212121',
  '--c-default': '#f0f0f0',
  '--c-border': '#444',
  '--v-border': '1px solid #444',
  '--h-field': '2pc',
  'color-scheme': 'dark'
};

const WHISTLE_LIGHT = {
  '--b-default': '#fff',
  '--b-bar': '#fafafa',
  '--c-default': '#000',
  '--c-border': '#ccc',
  '--v-border': '1px solid #ccc',
  '--h-field': '2pc',
  'color-scheme': 'light'
};

console.log('theme.test.js');

check('从宿主读取变量并注入本页（深色）', () => {
  const win = createWindow({ parent: createParentWindow({ theme: 'dark', vars: WHISTLE_DARK }) });
  const result = Theme.sync(win);
  const doc = win.document;
  assert.strictEqual(result.source, 'parent');
  assert.strictEqual(result.theme, 'dark');
  assert.strictEqual(doc._props['--b-default'], '#1a1a1a');
  assert.strictEqual(doc._props['--c-default'], '#f0f0f0');
  assert.strictEqual(doc._props['--v-border'], '1px solid #444');
  assert.strictEqual(doc._props['color-scheme'], 'dark');
  assert.strictEqual(doc._attrs['data-theme'], 'dark');
  // 覆盖 whistle 注入的 html{background:#fff}
  assert.strictEqual(doc.documentElement.style.backgroundColor, '#1a1a1a');
});

check('浅色宿主同样生效', () => {
  const win = createWindow({ parent: createParentWindow({ theme: 'light', vars: WHISTLE_LIGHT }) });
  const result = Theme.sync(win);
  assert.strictEqual(result.theme, 'light');
  assert.strictEqual(win.document._props['--b-default'], '#fff');
  assert.strictEqual(win.document._attrs['data-theme'], 'light');
  assert.strictEqual(win.document.documentElement.style.backgroundColor, '#fff');
});

check('宿主没有 data-theme 时，按 --b-default 推断主题', () => {
  const dark = Theme.readFromParent(createParentWindow({ vars: WHISTLE_DARK }));
  assert.strictEqual(dark.theme, 'dark');
  const light = Theme.readFromParent(createParentWindow({ vars: WHISTLE_LIGHT }));
  assert.strictEqual(light.theme, 'light');
});

check('宿主变量读不到（不是预期页面）时返回 null，走兜底', () => {
  assert.strictEqual(Theme.readFromParent(createParentWindow({ vars: {} })), null);
});

check('父窗口访问抛错时不崩，回退到兜底调色板（跟随系统偏好）', () => {
  const parent = {
    document: {
      documentElement: {
        getAttribute() {
          throw new Error('cross-origin');
        }
      }
    },
    getComputedStyle() {
      throw new Error('cross-origin');
    }
  };
  const win = createWindow({ parent, prefersDark: true });
  const result = Theme.sync(win);
  assert.strictEqual(result.source, 'fallback');
  assert.strictEqual(result.theme, 'dark');
  assert.strictEqual(win.document._props['--b-default'], Theme.FALLBACK.dark['--b-default']);
  assert.strictEqual(win.document._attrs['data-theme'], 'dark');
});

check('没有父窗口（单独打开页面）时用兜底调色板', () => {
  const win = createWindow({ prefersDark: false });
  const result = Theme.sync(win);
  assert.strictEqual(result.source, 'fallback');
  assert.strictEqual(result.theme, 'light');
  assert.strictEqual(win.document._props['--b-default'], '#fff');
});

check('变量清单包含 whistle 的关键变量', () => {
  ['--b-default', '--b-bar', '--c-default', '--c-thin', '--c-border', '--c-link', '--v-border', '--h-field'].forEach(
    (name) => {
      assert.ok(Theme.VAR_LIST.indexOf(name) !== -1, name + ' 应在同步清单中');
    }
  );
  assert.ok(Theme.VAR_LIST.length >= 20);
});

check('兜底调色板浅/深两套齐全', () => {
  ['light', 'dark'].forEach((theme) => {
    Theme.VAR_LIST.forEach((name) => {
      assert.ok(Theme.FALLBACK[theme][name], theme + ' 缺少 ' + name);
    });
  });
});

// 异步：watch 能跟随宿主主题变化
(async function () {
  try {
    const ownDoc = createOwnDocument();
    const parentWin = createParentWindow({ theme: 'light', vars: WHISTLE_LIGHT });
    const win = createWindow({ document: ownDoc, parent: parentWin });

    const changes = [];
    const stop = Theme.watch(win, (result) => changes.push(result.theme), 20);
    assert.strictEqual(ownDoc._attrs['data-theme'], 'light', '初始应为浅色');
    assert.strictEqual(changes.length, 1, '应立即回调一次');

    // 模拟宿主切到深色
    parentWin.getComputedStyle = () => ({
      getPropertyValue: (name) => (name in WHISTLE_DARK ? WHISTLE_DARK[name] : '')
    });
    parentWin.document.documentElement.getAttribute = () => 'dark';

    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.strictEqual(ownDoc._attrs['data-theme'], 'dark', '应同步为深色');
    assert.strictEqual(ownDoc._props['--b-default'], '#1a1a1a');
    assert.ok(changes.indexOf('dark') !== -1, '应回调深色变化：' + JSON.stringify(changes));

    const countBefore = changes.length;
    stop();
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.strictEqual(changes.length, countBefore, 'stop() 后不应再回调');

    passed += 1;
    console.log('  ✓ watch 跟随宿主主题变化（含 stop 生效）');
  } catch (err) {
    console.error('  ✗ watch 跟随宿主主题变化（含 stop 生效）');
    console.error('    ' + (err && err.message));
    process.exitCode = 1;
  }
  console.log('\n通过 ' + passed + ' 项' + (process.exitCode ? '（存在失败）' : ''));
})();
