/* Các hàm thuần (không đụng tới giao diện), dùng chung cho trình duyệt và bài kiểm thử. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GN = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var EARTH_R = 6371008.8;

  /** Màu cho từng thành viên. Chữ trên nền màu đều đạt tương phản tối thiểu 4,5:1. */
  var COLORS = [
    { bg: '#C2410C', fg: '#FFFFFF' },
    { bg: '#5F3DC4', fg: '#FFFFFF' },
    { bg: '#C2255C', fg: '#FFFFFF' },
    { bg: '#1971C2', fg: '#FFFFFF' },
    { bg: '#F2B53A', fg: '#2B1D00' },
    { bg: '#862E9C', fg: '#FFFFFF' },
    { bg: '#2F7D32', fg: '#FFFFFF' },
    { bg: '#0B7285', fg: '#FFFFFF' },
  ];

  function rad(d) {
    return (d * Math.PI) / 180;
  }

  /** Khoảng cách giữa hai điểm {lat,lng}, đơn vị mét. */
  function distance(a, b) {
    var dLat = rad(b.lat - a.lat);
    var dLng = rad(b.lng - a.lng);
    var s = Math.pow(Math.sin(dLat / 2), 2) + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.pow(Math.sin(dLng / 2), 2);
    return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(s)));
  }

  function fmtDist(m) {
    if (!isFinite(m)) return '';
    if (m < 100) return Math.max(5, Math.round(m / 5) * 5) + ' m';
    if (m < 1000) return Math.round(m / 10) * 10 + ' m';
    if (m < 10000) return String(Math.round(m / 100) / 10).replace('.', ',') + ' km';
    return Math.round(m / 1000) + ' km';
  }

  function fmtAgo(ms) {
    var s = Math.max(0, Math.round(ms / 1000));
    if (s < 5) return 'vừa xong';
    if (s < 60) return s + ' giây trước';
    var m = Math.round(s / 60);
    if (m < 60) return m + ' phút trước';
    var h = Math.floor(m / 60);
    if (h < 24) return h + ' giờ trước';
    return 'hơn 1 ngày trước';
  }

  /** Tốc độ (m/s) -> chuỗi km/h, rỗng nếu gần như đứng yên hoặc không có. */
  function fmtSpeed(mps) {
    if (typeof mps !== 'number' || !isFinite(mps)) return '';
    var kmh = Math.round(mps * 3.6);
    return kmh >= 4 ? kmh + ' km/h' : '';
  }

  function fmtTime(ts) {
    var d = new Date(ts);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  /** Trạng thái tín hiệu theo độ tuổi của lần cập nhật cuối. */
  function ageState(ageMs) {
    if (ageMs <= 45000) return 'live';
    if (ageMs <= 5 * 60000) return 'recent';
    return 'lost';
  }

  function normCode(s) {
    return String(s || '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 8);
  }

  function showCode(c) {
    return c && c.length === 8 ? c.slice(0, 4) + '-' + c.slice(4) : c || '';
  }

  function initial(name) {
    var ch = Array.from(String(name || '?').trim())[0] || '?';
    return ch.toLocaleUpperCase('vi');
  }

  function directionsUrl(p, kind) {
    var ll = p.lat.toFixed(6) + ',' + p.lng.toFixed(6);
    if (kind === 'apple') return 'https://maps.apple.com/?daddr=' + ll + '&dirflg=d';
    return 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(ll) + '&travelmode=driving';
  }

  return {
    COLORS: COLORS,
    distance: distance,
    fmtDist: fmtDist,
    fmtAgo: fmtAgo,
    fmtSpeed: fmtSpeed,
    fmtTime: fmtTime,
    ageState: ageState,
    normCode: normCode,
    showCode: showCode,
    initial: initial,
    directionsUrl: directionsUrl,
  };
});
