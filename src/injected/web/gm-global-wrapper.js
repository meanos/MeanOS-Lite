import { FastLookup, safeConcat } from './util';

const isFrameIndex = key => +key >= 0 && key < window::getWindowLength();
const scopeSym = SafeSymbol.unscopables;
const globalKeysSet = FastLookup();
const globalKeys = (function makeGlobalKeys() {
  const kWrappedJSObject = 'wrappedJSObject';
  const isContentMode = !PAGE_MODE_HANDSHAKE;
  const names = builtinGlobals[0]; // `window` keys
  const numFrames = window::getWindowLength();
  // True if `names` is usable as is, but FF is bugged: its names have duplicates
  let ok = !IS_FIREFOX;
  names::forEach(key => {
    if (+key >= 0 && key < numFrames
      || isContentMode && (
        key === process.env.INIT_FUNC_NAME || key === 'browser' || key === 'chrome'
      )
    ) {
      ok = false;
    } else {
      globalKeysSet.add(key);
    }
  });
  /* Chrome and FF page mode: `global` is `window`
     FF content mode: `global` is different, some props e.g. `isFinite` are defined only there */
  if (global !== window) {
    builtinGlobals[1]::forEach(key => {
      if (!(+key >= 0 && key < numFrames)) { // keep the `!` inversion to avoid safe-guarding isNaN
        globalKeysSet.add(key);
        ok = false;
      }
    });
  }
  // wrappedJSObject is not included in getOwnPropertyNames so we add it explicitly.
  if (IS_FIREFOX
    && !PAGE_MODE_HANDSHAKE
    && kWrappedJSObject in global
    && !globalKeysSet.has(kWrappedJSObject)) {
    globalKeysSet.add(kWrappedJSObject);
    if (ok) setOwnProp(names, names.length, kWrappedJSObject);
  }
  return ok ? names : globalKeysSet.toArray();
}());
const inheritedKeys = createNullObj();
/* These can be redefined but can't be assigned, see sandbox-globals.html */
const readonlyKeys = {
  __proto__: null,
  applicationCache: 1,
  caches: 1,
  closed: 1,
  crossOriginIsolated: 1,
  crypto: 1,
  customElements: 1,
  frameElement: 1,
  history: 1,
  indexedDB: 1,
  isSecureContext: 1,
  localStorage: 1,
  mozInnerScreenX: 1,
  mozInnerScreenY: 1,
  navigator: 1,
  sessionStorage: 1,
  speechSynthesis: 1,
  styleMedia: 1,
  trustedTypes: 1,
};
/* These can't be redefined, see sandbox-globals.html */
const unforgeables = {
  __proto__: null,
  Infinity: 1,
  NaN: 1,
  document: 1,
  location: 1,
  top: 1,
  undefined: 1,
  window: 1,
};
/* ~50 methods like alert/fetch/moveBy that need `window` as `this`, see sandbox-globals.html */
const MAYBE = vmOwnFunc; // something that can't be imitated by the page
const boundMethods = {
  __proto__: null,
  addEventListener: MAYBE,
  alert: MAYBE,
  atob: MAYBE,
  blur: MAYBE,
  btoa: MAYBE,
  cancelAnimationFrame: MAYBE,
  cancelIdleCallback: MAYBE,
  captureEvents: MAYBE,
  clearInterval: MAYBE,
  clearTimeout: MAYBE,
  close: MAYBE,
  confirm: MAYBE,
  createImageBitmap: MAYBE,
  dispatchEvent: MAYBE,
  dump: MAYBE,
  fetch: MAYBE,
  find: MAYBE,
  focus: MAYBE,
  getComputedStyle: MAYBE,
  getDefaultComputedStyle: MAYBE,
  getSelection: MAYBE,
  matchMedia: MAYBE,
  moveBy: MAYBE,
  moveTo: MAYBE,
  open: MAYBE,
  openDatabase: MAYBE,
  postMessage: MAYBE,
  print: MAYBE,
  prompt: MAYBE,
  queueMicrotask: MAYBE,
  releaseEvents: MAYBE,
  removeEventListener: MAYBE,
  requestAnimationFrame: MAYBE,
  requestIdleCallback: MAYBE,
  resizeBy: MAYBE,
  resizeTo: MAYBE,
  scroll: MAYBE,
  scrollBy: MAYBE,
  scrollByLines: MAYBE,
  scrollByPages: MAYBE,
  scrollTo: MAYBE,
  setInterval: MAYBE,
  setResizable: MAYBE,
  setTimeout: MAYBE,
  sizeToContent: MAYBE,
  stop: MAYBE,
  updateCommands: MAYBE,
  webkitCancelAnimationFrame: MAYBE,
  webkitRequestAnimationFrame: MAYBE,
  webkitRequestFileSystem: MAYBE,
  webkitResolveLocalFileSystemURL: MAYBE,
};

if (process.env.DEBUG) throwIfProtoPresent(unforgeables);
for (const name in unforgeables) { /* proto is null */// eslint-disable-line guard-for-in
  let thisObj;
  let info = (
    describeProperty(thisObj = global, name)
    || describeProperty(thisObj = window, name)
  );
  let fn;
  if (info) {
    info = createNullObj(info);
    // currently only `document` and `window`
    if ((fn = info.get)) info.get = fn::bind(thisObj);
    // currently only `location`
    if ((fn = info.set)) info.set = fn::bind(thisObj);
    unforgeables[name] = info;
  } else {
    delete unforgeables[name];
  }
}
[SafeEventTarget, Object]::forEach(src => {
  getOwnPropertyNames(src[PROTO])::forEach(key => {
    inheritedKeys[key] = 1;
  });
});
builtinGlobals = null; // eslint-disable-line no-global-assign

/**
 * @desc Wrap helpers to prevent unexpected modifications.
 */
export function makeGlobalWrapper(local) {
  const events = createNullObj();
  const readonlys = createNullObj(readonlyKeys);
  let globals = globalKeysSet; // will be copied only if modified
  /* Browsers may return [object Object] for Object.prototype.toString(window)
     on our `window` proxy so jQuery libs see it as a plain object and throw
     when trying to clone its recursive properties like `self` and `window`. */
  safeDefineProperty(local, toStringTagSym, { get: () => 'Window' });
  const wrapper = new SafeProxy(local, {
    __proto__: null,
    defineProperty(_, name, desc) {
      const isStr = isString(name);
      if (!isStr || !isFrameIndex(name)) {
        safeDefineProperty(local, name, desc);
        if (isStr) setEventHandler(name);
        delete readonlys[name];
      }
      return true;
    },
    deleteProperty(_, name) {
      if (!(name in unforgeables) && delete local[name]) {
        if (globals.has(name)) {
          if (globals === globalKeysSet) {
            globals = globalKeysSet.clone();
          }
          globals.delete(name);
        }
        return true;
      }
    },
    // Reducing "steppability" so it doesn't get in the way of debugging other parts of our code.
    // eslint-disable-next-line no-return-assign, no-nested-ternary
    get: (_, name) => (name === 'undefined' || name === scopeSym ? undefined
      : (_ = local[name]) !== undefined || name in local ? _
        : resolveProp(name, wrapper, globals, local)
    ),
    getOwnPropertyDescriptor(_, name) {
      const ownDesc = describeProperty(local, name);
      const desc = ownDesc || globals.has(name) && describeProperty(global, name);
      if (!desc) return;
      if (getOwnProp(desc, 'value') === window) {
        desc.value = wrapper;
      }
      // preventing spec violation - we must mirror an unknown unforgeable prop
      // preventing error for libs like ReactDOM that hook window.event
      if (!ownDesc && (!getOwnProp(desc, 'configurable') || name === 'event')) {
        const get = getOwnProp(desc, 'get');
        const set = getOwnProp(desc, 'set'); // for window.event
        if (get) desc.get = get::bind(global);
        if (set) desc.set = set::bind(global);
        safeDefineProperty(local, name, desc);
      }
      return desc;
    },
    has: (_, name) => name in local || name in inheritedKeys || globals.has(name),
    ownKeys: () => makeOwnKeys(local, globals),
    preventExtensions() {},
    set(_, name, value) {
      const isStr = isString(name);
      let readonly = readonlys[name];
      if (readonly === 1) {
        readonly = globals.has(name) ? 2 : 0;
        readonlys[name] = readonly;
      }
      if (!readonly && (!isStr || !isFrameIndex(name))) {
        local[name] = value;
        if (isStr) setEventHandler(name, value, globals, events);
      }
      return true;
    },
  });
  for (const name in unforgeables) { /* proto is null */// eslint-disable-line guard-for-in
    const desc = unforgeables[name];
    if (name === 'window' || name === 'top' && IS_TOP) {
      delete desc.get;
      delete desc.set;
      desc.value = wrapper;
    }
    if (process.env.DEBUG) throwIfProtoPresent(desc);
    /* proto is already null */// eslint-disable-next-line no-restricted-syntax
    defineProperty(local, name, desc);
  }
  return wrapper;
}

function makeOwnKeys(local, globals) {
  /** Note that arrays can be eavesdropped via prototype setters like '0','1',...
   * on `push` and `arr[i] = 123`, as well as via getters if you read beyond
   * its length or from an unassigned `hole`. */
  const names = getOwnPropertyNames(local)::filter(notIncludedIn, globals);
  const symbols = getOwnPropertySymbols(local)::filter(notIncludedIn, globals);
  const frameIndexes = [];
  for (let i = 0, len = window::getWindowLength(); i < len && window::hasOwnProperty(i); i += 1) {
    if (!(i in local)) {
      setOwnProp(frameIndexes, i, i);
    }
  }
  return safeConcat(
    frameIndexes,
    globals === globalKeysSet ? globalKeys : globals.toArray(),
    names,
    symbols,
  );
}

function resolveProp(name, wrapper, globals, local) {
  let value = boundMethods[name];
  if (value === MAYBE) {
    value = window[name];
    if (isFunction(value)) {
      value = value::bind(window);
    }
    boundMethods[name] = value;
  }
  const canCopy = value || name in inheritedKeys || globals.has(name);
  if (!value && (canCopy || isString(name) && isFrameIndex(name))) {
    value = global[name];
  }
  if (value === window || name === 'globalThis') {
    value = wrapper;
  }
  if (canCopy && (
    isFunction(value) || isObject(value) && name !== 'event'
    // window.event contains the current event so it's always different
  )) {
    local[name] = value;
  }
  return value;
}

function setEventHandler(name, value, globals, events) {
  // Spoofed String index getters won't be called within length, length itself is unforgeable
  if (name.length < 3 || name[0] !== 'o' || name[1] !== 'n' || !globals.has(name)) {
    return;
  }
  name = name::slice(2);
  window::off(name, events[name]);
  if (isFunction(value)) {
    // the handler will be unique so that one script couldn't remove something global
    // like console.log set by another script
    window::on(name, events[name] = value::bind(window));
  } else {
    delete events[name];
  }
}

/** @this {FastLookup|Set} */
function notIncludedIn(key) {
  return !this.has(key);
}
