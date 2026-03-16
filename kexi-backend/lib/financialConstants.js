const STORE_REGISTRY = [
  { id: 'meixihu', name: '梅溪湖店' },
  { id: 'huachuang', name: '华创店' },
  { id: 'kaideyi', name: '凯德壹店' },
  { id: 'wanxiangcheng', name: '万象城店' },
  { id: 'desiqin', name: '德思勤店' },
  { id: 'jiazhaoye', name: '佳兆业店' },
];

const STORE_ALIASES = new Map([
  ['梅溪湖店', 'meixihu'],
  ['梅溪湖', 'meixihu'],
  ['姊呮邯婀栧簵', 'meixihu'],
  ['姊呮邯婀?', 'meixihu'],
  ['华创店', 'huachuang'],
  ['华创', 'huachuang'],
  ['鍗庡垱搴?', 'huachuang'],
  ['鍗庡垱', 'huachuang'],
  ['凯德壹店', 'kaideyi'],
  ['凯德壹', 'kaideyi'],
  ['鍑痉澹瑰簵', 'kaideyi'],
  ['鍑痉澹?', 'kaideyi'],
  ['万象城店', 'wanxiangcheng'],
  ['万象城', 'wanxiangcheng'],
  ['涓囪薄鍩庡簵', 'wanxiangcheng'],
  ['涓囪薄鍩?', 'wanxiangcheng'],
  ['德思勤店', 'desiqin'],
  ['德思勤', 'desiqin'],
  ['寰锋€濆嫟搴?', 'desiqin'],
  ['寰锋€濆嫟', 'desiqin'],
  ['佳兆业店', 'jiazhaoye'],
  ['佳兆业', 'jiazhaoye'],
  ['浣冲厗涓氬簵', 'jiazhaoye'],
  ['浣冲厗涓?', 'jiazhaoye'],
]);

function cleanText(value) {
  return String(value ?? '')
    .replace(/\r/g, '')
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeKey(value) {
  return cleanText(value)
    .replace(/[，。！？、,.!?：:；;（）()【】[\]'"“”‘’]/g, '')
    .replace(/\s+/g, '')
    .toLowerCase();
}

function resolveStore(input) {
  if (!input) {
    return null;
  }

  const normalizedInput = normalizeKey(input);

  for (const store of STORE_REGISTRY) {
    if (store.id === normalizedInput) {
      return store;
    }
  }

  for (const [alias, storeId] of STORE_ALIASES.entries()) {
    if (normalizedInput.includes(normalizeKey(alias))) {
      return STORE_REGISTRY.find((store) => store.id === storeId) || null;
    }
  }

  return null;
}

function inferPeriod(input) {
  const text = cleanText(input);
  const match = text.match(/(20\d{2})\s*年\s*(0?[1-9]|1[0-2])\s*月?/);

  if (!match) {
    return null;
  }

  return `${match[1]}-${String(match[2]).padStart(2, '0')}`;
}

function formatPeriodLabel(period) {
  if (!period) {
    return '未识别月份';
  }

  const [year, month] = String(period).split('-');
  return `${year}年${Number(month)}月`;
}

function sortPeriods(periods = []) {
  return [...new Set(periods.filter(Boolean))].sort((left, right) =>
    left.localeCompare(right),
  );
}

module.exports = {
  STORE_REGISTRY,
  cleanText,
  formatPeriodLabel,
  inferPeriod,
  normalizeKey,
  resolveStore,
  sortPeriods,
};
