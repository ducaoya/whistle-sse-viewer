/**
 * 配置页（public/index.html）集成测试
 *
 * 用最小 DOM 桩 + vm 真实执行页面里的内联脚本，验证：
 *   1. 打开页面时“预览字符数”输入框直接填入默认值 3000（不是空白）
 *   2. 已有本机配置时展示该配置
 *   3. 保存成功 → 写入 localStorage 并弹出成功提示
 *   4. 输入非法 → 弹出失败提示且不写入
 *   5. 恢复默认 → 清除本机配置并提示
 *   6. localStorage 不可用 → 保存/恢复都给出失败提示
 *
 *   node test/options-page.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SseView = require(path.join(__dirname, '..', 'public', 'sse-view.js'));
const SseTheme = require(path.join(__dirname, '..', 'public', 'theme.js'));

// 测试里不启动真实轮询（watch 的定时逻辑由 test/theme.test.js 覆盖），只做一次同步
const SseThemeForPage = {
  sync: SseTheme.sync,
  watch: function (win) {
    return SseTheme.sync(win);
  },
  VAR_LIST: SseTheme.VAR_LIST,
  FALLBACK: SseTheme.FALLBACK
};
const HTML = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

const ELEMENT_IDS = [
  'previewLimit',
  'previewMode',
  'trailingSeparator',
  'formatJson',
  'tag-limit',
  'tag-mode',
  'tag-sep',
  'tag-json',
  'limit-hint',
  'status',
  'current',
  'source',
  'toast',
  'save',
  'reset'
];

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

function createElement(id) {
  const el = {
    id,
    _value: '',
    textContent: '',
    placeholder: '',
    className: '',
    _listeners: {},
    addEventListener(type, fn) {
      (el._listeners[type] = el._listeners[type] || []).push(fn);
    },
    fire(type, event) {
      (el._listeners[type] || []).forEach((fn) => fn(event || {}));
    },
    click() {
      el.fire('click');
    }
  };
  Object.defineProperty(el, 'value', {
    get() {
      return el._value;
    },
    set(v) {
      el._value = v == null ? '' : String(v);
    }
  });
  return el;
}

function createStorage(initial, options) {
  const opts = options || {};
  const data = Object.assign({}, initial);
  return {
    _data: data,
    getItem(key) {
      return key in data ? data[key] : null;
    },
    setItem(key, value) {
      if (opts.throwOnSet) {
        const err = new Error('quota exceeded');
        err.name = 'QuotaExceededError';
        throw err;
      }
      data[key] = String(value);
    },
    removeItem(key) {
      delete data[key];
    }
  };
}

const FETCH_OK = {
  ok: true,
  json: () =>
    Promise.resolve({
      previewLimit: 3000,
      previewMode: 'tail',
      trailingSeparator: false,
      formatJson: false
    })
};

const INLINE_SCRIPT = (HTML.match(/<script>([\s\S]*?)<\/script>/g) || [])
  .map((block) => block.replace(/^<script>/, '').replace(/<\/script>$/, ''))
  .join('\n');

// 执行页面脚本，返回 { elements, storage }
function runPage(options) {
  const opts = options || {};
  const elements = {};
  ELEMENT_IDS.forEach((id) => {
    elements[id] = createElement(id);
  });
  const storage = opts.storage === null ? null : opts.storage || createStorage();
  const bodyHtml = [];
  const themeProps = {};
  const themeAttrs = {};
  const documentStub = {
    getElementById: (id) => elements[id] || null,
    body: {
      insertAdjacentHTML: (position, html) => bodyHtml.push(html)
    },
    documentElement: {
      style: {
        setProperty: (name, value) => {
          themeProps[name] = value;
        },
        backgroundColor: ''
      },
      getAttribute: (name) => (name in themeAttrs ? themeAttrs[name] : null),
      setAttribute: (name, value) => {
        themeAttrs[name] = value;
      }
    }
  };
  const sandbox = {
    window: {
      localStorage: storage,
      SseView: opts.sseView === undefined ? SseView : opts.sseView,
      SseTheme: opts.sseTheme === undefined ? SseThemeForPage : opts.sseTheme,
      document: documentStub,
      matchMedia: () => ({ matches: false }),
      addEventListener: () => {},
      getComputedStyle: () => ({ getPropertyValue: () => '' })
    },
    document: documentStub,
    fetch: opts.fetch || (() => Promise.resolve(FETCH_OK)),
    // 不真正排定定时器，避免测试等待 toast 自动消失 / 主题轮询
    setTimeout: () => 0,
    setInterval: () => 0,
    clearTimeout: () => {},
    clearInterval: () => {},
    console
  };
  sandbox.globalThis = sandbox;
  sandbox.window.parent = sandbox.window; // 无宿主：走兜底调色板
  vm.runInNewContext(INLINE_SCRIPT, sandbox, { filename: 'index.html' });
  return { elements, storage, bodyHtml, themeProps, themeAttrs };
}

function tick() {
  return new Promise((resolve) => setTimeout(resolve, 5));
}

console.log('options-page.test.js');
console.log('  内联脚本长度: ' + INLINE_SCRIPT.length + ' 字符');

check('首屏（fetch 未返回前）输入框已填入默认 3000', () => {
  const { elements } = runPage();
  assert.strictEqual(elements.previewLimit.value, '3000');
  assert.strictEqual(elements.previewMode.value, 'tail');
  assert.strictEqual(elements.trailingSeparator.value, 'false');
  assert.strictEqual(elements.formatJson.value, 'false');
});

check('默认值标签显示 3000 / tail / 不补 / 关闭', () => {
  const { elements } = runPage();
  assert.strictEqual(elements['tag-limit'].textContent, '默认 3000');
  assert.strictEqual(elements['tag-mode'].textContent, '默认 tail');
  assert.strictEqual(elements['tag-sep'].textContent, '默认 不补');
  assert.strictEqual(elements['tag-json'].textContent, '默认 关闭');
});

check('已有本机配置时展示该配置（previewLimit=-1 等）', () => {
  const storage = createStorage({
    [SseView.CONFIG_KEY]: JSON.stringify({
      previewLimit: -1,
      previewMode: 'head',
      trailingSeparator: true,
      formatJson: true
    })
  });
  const { elements } = runPage({ storage });
  assert.strictEqual(elements.previewLimit.value, '-1');
  assert.strictEqual(elements.previewMode.value, 'head');
  assert.strictEqual(elements.trailingSeparator.value, 'true');
  assert.strictEqual(elements.formatJson.value, 'true');
  assert.ok(elements.current.textContent.indexOf('"previewLimit": -1') !== -1);
  assert.ok(elements.source.textContent.indexOf('localStorage') !== -1);
});

check('保存成功：写入 localStorage 并弹出成功提示', () => {
  const { elements, storage } = runPage();
  elements.previewLimit.value = '5000';
  elements.previewLimit.fire('input');
  elements.previewMode.value = 'head';
  elements.previewMode.fire('change');
  elements.save.click();
  const saved = JSON.parse(storage.getItem(SseView.CONFIG_KEY));
  assert.strictEqual(saved.previewLimit, 5000);
  assert.strictEqual(saved.previewMode, 'head');
  assert.ok(elements.toast.textContent.indexOf('保存成功') !== -1, 'toast: ' + elements.toast.textContent);
  assert.ok(elements.toast.className.indexOf('ok') !== -1);
  assert.ok(elements.toast.className.indexOf('show') !== -1);
});

check('预览字符数留空：保存时按默认值 3000 写入', () => {
  const { elements, storage } = runPage();
  elements.previewLimit.value = '';
  elements.previewLimit.fire('input');
  elements.save.click();
  assert.strictEqual(JSON.parse(storage.getItem(SseView.CONFIG_KEY)).previewLimit, 3000);
  assert.ok(elements.toast.textContent.indexOf('保存成功') !== -1);
});

check('输入非法：弹出失败提示且不写入', () => {
  const { elements, storage } = runPage();
  elements.previewLimit.value = 'abc';
  elements.previewLimit.fire('input');
  elements.save.click();
  assert.strictEqual(storage.getItem(SseView.CONFIG_KEY), null, '不应写入');
  assert.ok(elements.toast.textContent.indexOf('保存失败') !== -1, 'toast: ' + elements.toast.textContent);
  assert.ok(elements.toast.className.indexOf('err') !== -1);
});

check('localStorage 抛错（配额满）：保存给出失败提示', () => {
  const { elements } = runPage({ storage: createStorage({}, { throwOnSet: true }) });
  elements.save.click();
  assert.ok(elements.toast.textContent.indexOf('保存失败') !== -1, 'toast: ' + elements.toast.textContent);
  assert.ok(elements.toast.className.indexOf('err') !== -1);
});

check('localStorage 不可用：保存给出失败提示', () => {
  const { elements } = runPage({ storage: null });
  elements.save.click();
  assert.ok(elements.toast.textContent.indexOf('保存失败') !== -1, 'toast: ' + elements.toast.textContent);
  assert.ok(elements.toast.textContent.indexOf('localStorage') !== -1);
});

check('恢复默认：清除配置并提示成功', () => {
  const storage = createStorage({
    [SseView.CONFIG_KEY]: JSON.stringify({ previewLimit: 800 })
  });
  const { elements } = runPage({ storage });
  assert.strictEqual(elements.previewLimit.value, '800');
  elements.reset.click();
  assert.strictEqual(storage.getItem(SseView.CONFIG_KEY), null);
  assert.strictEqual(elements.previewLimit.value, '3000');
  assert.ok(elements.toast.textContent.indexOf('已恢复默认值') !== -1, 'toast: ' + elements.toast.textContent);
  assert.ok(elements.toast.className.indexOf('ok') !== -1);
});

check('页面会同步主题变量（兜底调色板）', () => {
  const { themeProps, themeAttrs } = runPage();
  assert.strictEqual(themeAttrs['data-theme'], 'light');
  assert.strictEqual(themeProps['--b-default'], '#fff');
  assert.ok(themeProps['--v-border'], '应注入边框变量');
});

check('sse-view.js 未加载时给出可见报错，而不是静默空白', () => {
  const { bodyHtml, elements } = runPage({ sseView: null });
  assert.strictEqual(bodyHtml.length, 1, '应插入一条报错横幅');
  assert.ok(bodyHtml[0].indexOf('加载 sse-view.js 失败') !== -1, bodyHtml[0].slice(0, 120));
  assert.strictEqual(elements.previewLimit.value, '', '此时不应填值（由报错横幅提示）');
});

(async function () {
  try {
    const { elements } = runPage({
      fetch: () =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              previewLimit: 5000,
              previewMode: 'tail',
              trailingSeparator: false,
              formatJson: false
            })
        })
    });
    assert.strictEqual(elements.previewLimit.value, '3000'); // 首屏先用内置默认
    await tick();
    assert.strictEqual(elements.previewLimit.value, '5000');
    assert.strictEqual(elements['tag-limit'].textContent, '默认 5000');
    passed += 1;
    console.log('  ✓ 异步拿到服务端默认值（如改成 5000）后会刷新显示');
  } catch (err) {
    console.error('  ✗ 异步拿到服务端默认值（如改成 5000）后会刷新显示');
    console.error('    ' + (err && err.message));
    process.exitCode = 1;
  }
  console.log(
    '\n' + (process.exitCode ? '存在失败（通过 ' + passed + ' 项）' : '通过 ' + passed + ' 项')
  );
})();
