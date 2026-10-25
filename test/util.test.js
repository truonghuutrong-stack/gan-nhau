'use strict';
const assert = require('assert/strict');
const GN = require('../public/util.js');

let n = 0;
function t(name, fn) {
  fn();
  n++;
  console.log('  ok   ' + name);
}

t('khoảng cách giữa hai điểm đã biết', () => {
  // Bến Thành -> Nhà thờ Đức Bà: khoảng 1,0 km
  const d = GN.distance({ lat: 10.772, lng: 106.698 }, { lat: 10.7798, lng: 106.699 });
  assert.ok(d > 850 && d < 900, 'được ' + d);
  assert.equal(GN.distance({ lat: 1, lng: 1 }, { lat: 1, lng: 1 }), 0);
  // Hà Nội -> TP.HCM: khoảng 1.140 km theo đường chim bay
  const far = GN.distance({ lat: 21.0285, lng: 105.8542 }, { lat: 10.8231, lng: 106.6297 });
  assert.ok(far > 1.12e6 && far < 1.16e6, 'được ' + far);
});

t('định dạng khoảng cách', () => {
  assert.equal(GN.fmtDist(2), '5 m');
  assert.equal(GN.fmtDist(47), '45 m');
  assert.equal(GN.fmtDist(612), '610 m');
  assert.equal(GN.fmtDist(1000), '1 km');
  assert.equal(GN.fmtDist(1840), '1,8 km');
  assert.equal(GN.fmtDist(27400), '27 km');
  assert.equal(GN.fmtDist(NaN), '');
});

t('định dạng thời gian và tốc độ', () => {
  assert.equal(GN.fmtAgo(1000), 'vừa xong');
  assert.equal(GN.fmtAgo(30000), '30 giây trước');
  assert.equal(GN.fmtAgo(180000), '3 phút trước');
  assert.equal(GN.fmtAgo(2 * 3600e3), '2 giờ trước');
  assert.equal(GN.fmtSpeed(0.5), '');
  assert.equal(GN.fmtSpeed(null), '');
  assert.equal(GN.fmtSpeed(13.9), '50 km/h');
  assert.equal(GN.ageState(10000), 'live');
  assert.equal(GN.ageState(120000), 'recent');
  assert.equal(GN.ageState(600000), 'lost');
});

t('mã nhóm và chữ cái đầu', () => {
  assert.equal(GN.normCode(' abcd-efgh '), 'ABCDEFGH');
  assert.equal(GN.normCode('abcd-efgh-xyz'), 'ABCDEFGH');
  assert.equal(GN.showCode('ABCDEFGH'), 'ABCD-EFGH');
  assert.equal(GN.initial('đức'), 'Đ');
  assert.equal(GN.initial('  mẹ'), 'M');
  assert.equal(GN.initial('😀 vui'), '😀');
  assert.equal(GN.initial(''), '?');
});

t('liên kết chỉ đường', () => {
  const g = GN.directionsUrl({ lat: 10.5, lng: 107.25 });
  assert.match(g, /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&destination=10\.500000%2C107\.250000/);
  assert.match(GN.directionsUrl({ lat: 10.5, lng: 107.25 }, 'apple'), /^https:\/\/maps\.apple\.com\/\?daddr=10\.500000,107\.250000/);
});

t('bảng màu đủ tương phản', () => {
  function lum(hex) {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  for (const c of GN.COLORS) {
    const a = lum(c.bg);
    const b = lum(c.fg);
    const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    assert.ok(ratio >= 4.5, c.bg + ' chỉ đạt ' + ratio.toFixed(2));
  }
  assert.equal(GN.COLORS.length, 8);
});

console.log('\n' + n + ' kiểm thử hàm tiện ích đạt');
