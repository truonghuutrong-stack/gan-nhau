/* Service worker tối giản: chỉ để trình duyệt cho phép "Cài ứng dụng" / "Thêm vào màn hình chính".
   Cố ý KHÔNG lưu đệm gì: vị trí phải luôn mới, và bản cập nhật app luôn lấy thẳng từ máy chủ. */
self.addEventListener('install', function () {
  self.skipWaiting();
});
self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());
});
self.addEventListener('fetch', function () {
  /* để trình duyệt tự xử lý mọi yêu cầu */
});
