const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const test = require('node:test'), assert = require('node:assert/strict'), ts = require('typescript');

// Run the actual component with a small hook/element host. Square and storage are
// injected so failure/recovery transitions can be exercised without charging.
function mount(file, options = {}) {
  const hooks = []; let cursor = 0, dirty = true, tree, jobs = [], loads = 0, attaches = 0;
  const jsx = (type, props) => ({ type, props: props || {} });
  const react = {
    useState(initial) { const i = cursor++; if (!(i in hooks)) hooks[i] = typeof initial === 'function' ? initial() : initial;
      return [hooks[i], value => { const next = typeof value === 'function' ? value(hooks[i]) : value; if (!Object.is(next, hooks[i])) { hooks[i] = next; dirty = true; } }]; },
    useRef(initial) { const i = cursor++; return hooks[i] ||= { current: initial }; },
    useEffect(fn, deps) { const i = cursor++, old = hooks[i]; if (!old || deps.some((d, n) => !Object.is(d, old.deps[n]))) { hooks[i] = { deps, cleanup: old?.cleanup }; jobs.push(() => { hooks[i].cleanup?.(); hooks[i].cleanup = fn(); }); } },
    useMemo(fn) { return fn(); }, useCallback(fn) { return fn; },
    createContext() { return { Provider: 'provider' }; },
  };
  const product = { slug: 'maeve', name: 'Maeve', price: 65, cats: [] };
  const catalog = { bySlug: new Map([['maeve', product]]), products: [product], money: n => `$${n}` };
  const config = { cards: true, applicationId: 'test', locationId: 'test', env: 'sandbox' };
  const modules = {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'fragment' }, '@/lib/catalog': catalog,
    '@/components/Cart': { useCart: () => ({ items: [{ product, qty: 1 }], lines: [{ slug: 'maeve', qty: 1 }], subtotal: 65, count: 1, clear() {}, add() {}, remove() {}, setQty() {} }) },
    '@/components/ProductImage': { default: 'image' }, '@/lib/nav': { href: p => '/demo' + (p || '') },
    '@/components/workroom/ui': {textButton:{}},
    '@/lib/site': { site: { deliveryFees: { '49068': 8.95 }, deliveryMinimums: { marshall: 45, outside: 55 }, marshallZip: '49068', deliveryZips: ['49068'], phone: '269-789-0830', phoneHref: 'tel:2697890830', email: 'test@example.invalid', delivery: {} } },
    '@/lib/occasions': { occasions: [] },
    '@/lib/square/web-sdk': { loadSquareSdk: async () => { loads++; if (options.sdkFails) throw Error('SDK offline'); } },
  };
  const storage = options.storage || { getItem: () => options.pending ? 'saved-reference' : null, setItem() {}, removeItem() {} };
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const FrozenDate = class extends Date { constructor(...args) { super(...(args.length ? args : ['2026-09-17T01:00:00Z'])); } };
  new vm.Script(source).runInNewContext({ module, exports: module.exports, require: name => { if (!(name in modules)) throw Error(name); return modules[name]; }, Date: FrozenDate, Intl, localStorage: storage, sessionStorage: storage,
    window: { scrollTo() {}, Square: { payments: async () => ({ card: async () => ({ attach: async () => { attaches++; }, destroy: async () => {}, tokenize: async () => ({ status: "OK", token: "test-token" }) }) }) } },
    setInterval: () => 1, clearInterval() {}, setTimeout:()=>1, clearTimeout(){}, AbortSignal, FormData: class { get() { return null; } }, crypto: require('node:crypto'),
    fetch: options.fetch || (async url => ({ ok: false, status: 503, json: async () => url === '/api/checkout/config' ? config : options.recovery || { ok: false, failed: true } })),
  });
  const component = module.exports.default || module.exports.CartProvider;
  function nodes(node = tree, result = []) { if (!node || typeof node !== 'object') return result; if (Array.isArray(node)) { node.forEach(n => nodes(n ?? null, result)); return result; } result.push(node); if (node.props?.children !== undefined) nodes(node.props.children, result); return result; }
  async function flush() { for (let i = 0; i < 20; i++) { if (dirty) { dirty = false; cursor = 0; tree = component({ children: null,...options.props }); nodes().forEach(n => { if (n.props?.ref) n.props.ref.current = { focus() {} }; }); const pending = jobs; jobs = []; pending.forEach(fn => fn()); } await new Promise(resolve => setImmediate(resolve)); if (!dirty && !jobs.length) return; } throw Error('Render loop did not settle'); }
  const find = predicate => { const found = nodes().find(predicate); assert.ok(found, 'Expected control exists'); return found; };
  return { flush, find, nodes, get tree() { return tree; }, get loads() { return loads; }, get attaches() { return attaches; } };
}

async function openPickup(ui) {
  await ui.flush();
  ui.find(n => n.type === 'button' && n.props.children === 'Continue to checkout').props.onClick(); await ui.flush();
  ui.nodes().filter(n => n.type === 'input' && n.props.name === 'fulfillment')[1].props.onChange(); await ui.flush();
}

test('Square failure settles on pay-on-call without automatic retrying', async () => {
  const ui = mount('src/components/CartView.tsx', { sdkFails: true }); await openPickup(ui);
  assert.equal(ui.loads, 1);
  assert.ok(ui.find(n => n.type === 'button' && n.props.children === 'Send the order'));
});

test('switching payment methods remounts the card field', async () => {
  const ui = mount('src/components/CartView.tsx'); await openPickup(ui); assert.equal(ui.attaches, 1);
  // Removing the card option and restoring it is the same mount boundary as
  // returning from the recovery screen; exercise both DOM lifetimes.
  const radios = () => ui.nodes().filter(n => n.type === 'input' && n.props.name === 'paymethod');
  radios()[1].props.onChange(); await ui.flush();
  radios()[0].props.onChange(); await ui.flush(); assert.equal(ui.attaches, 2);
});

test('blocked browser storage still allows pay-on-call checkout to render', async () => {
  const ui = mount('src/components/CartView.tsx', { storage: { getItem() { throw Error('blocked'); } } });
  await ui.flush(); assert.ok(ui.find(n => n.props.children === 'Continue to checkout'));
});

test('recovered success survives storage cleanup failure and omits an unknown date', async () => {
  const ui = mount('src/components/CartView.tsx', { storage: { getItem: () => 'saved-reference', removeItem() { throw Error('blocked'); } }, recovery: { ok: true, number: 'DV-TEST', paid: { totalCents: 6500, feeCents: 0 } } });
  await ui.flush(); await ui.find(n => n.props.children === 'Check payment status').props.onClick(); await ui.flush();
  assert.ok(ui.find(n => n.props.children === 'Your payment is confirmed. Call the shop if you need to check the fulfillment details.'));
});

test('date minimum follows Michigan evening instead of UTC tomorrow', async () => {
  const ui = mount('src/components/CartView.tsx'); await openPickup(ui);
  assert.equal(ui.find(n => n.type === 'input' && n.props.type === 'date').props.min, '2026-09-16');
});

test('repeated product adds never exceed the server quantity cap', async () => {
  const ui = mount('src/components/Cart.tsx'); await ui.flush();
  ui.tree.props.value.add('maeve', 99); await ui.flush(); ui.tree.props.value.add('maeve'); await ui.flush();
  assert.equal(ui.tree.props.value.count, 99); assert.equal(ui.tree.props.value.subtotal, 6435);
  ui.tree.props.value.setQty('maeve', NaN); await ui.flush(); assert.equal(ui.tree.props.value.count, 99);
});



test('pending payment recovery destroys and remounts card entry on the same checkout', async () => {
  const ui = mount('src/components/CartView.tsx'); await openPickup(ui);
  assert.equal(ui.attaches, 1);
  await ui.find(n => n.type === 'form').props.onSubmit({ preventDefault() {}, currentTarget: {} }); await ui.flush();
  await ui.find(n => n.props.children === 'Check payment status').props.onClick(); await ui.flush();
  ui.find(n => n.props.children === 'Return to checkout').props.onClick(); await ui.flush();
  assert.equal(ui.attaches, 2);
});

test('staff can switch a declined card to cash without an owner and sends the exact failed reference',async()=>{
 const attempts=[];let paid=0;
 const reference='bb3328c9-7bd1-4ef9-831e-46c57718d0c9';
 const ui=mount('src/components/workroom/PayControls.tsx',{props:{orderId:'fixture',subtotal:20,onPaid:()=>paid++},fetch:async(url,options)=>{
  if(url.endsWith('square-web'))return {ok:true,json:async()=>({applicationId:'fixture',locationId:'fixture',env:'sandbox'})};
  attempts.push(JSON.parse(options.body));return {ok:attempts.length>1,json:async()=>attempts.length===1?{failed:true,retryOf:reference,error:'Declined. Try another payment method.'}:{ok:true}};
 }});
 await ui.flush();ui.find(n=>n.props.children==='Take card').props.onClick();await ui.flush();
 await ui.find(n=>typeof n.props.children==='string'&&n.props.children.startsWith('Charge $')).props.onClick();await ui.flush();
 assert.equal(ui.find(n=>n.props.children==='Record cash').props.disabled,false);
 ui.find(n=>n.props.children==='Record cash').props.onClick();await ui.flush();
 await ui.find(n=>n.props.children==='Record $20.00 cash').props.onClick();await ui.flush();
 assert.equal(paid,1);assert.equal(attempts[1].retryOf,reference);assert.equal(attempts[1].method,'cash');assert.notEqual(attempts[0].attemptId,attempts[1].attemptId);
});
test('a lost workroom response disables another collection rather than offering a safe retry',async()=>{
 let requests=0;
 const ui=mount('src/components/workroom/PayControls.tsx',{props:{orderId:'fixture',subtotal:20,onPaid(){}},fetch:async()=>{requests++;throw Error('Response lost');}});
 await ui.flush();ui.find(n=>n.props.children==='Record cash').props.onClick();await ui.flush();
 await ui.find(n=>n.props.children==='Record $20.00 cash').props.onClick();await ui.flush();
 const button=ui.find(n=>n.props.children==='Record $20.00 cash');assert.equal(button.props.disabled,true);await button.props.onClick();assert.equal(requests,1);
});
test('a known unsubmitted online payment immediately exposes Return to checkout',async()=>{
 const message='No payment was submitted. Return to checkout after payment setup is checked.';
 const ui=mount('src/components/CartView.tsx',{fetch:async url=>url==='/api/checkout/config'?{ok:true,json:async()=>({cards:true,applicationId:'test',locationId:'test',env:'sandbox'})}:{ok:false,status:402,json:async()=>({ok:false,failed:true,pending:false,error:message})}});
 await openPickup(ui);await ui.find(n=>n.type==='form').props.onSubmit({preventDefault(){},currentTarget:{}});await ui.flush();
 assert.ok(ui.find(n=>n.props.children==='Return to checkout'));assert.ok(ui.find(n=>n.props.children===message));
});
