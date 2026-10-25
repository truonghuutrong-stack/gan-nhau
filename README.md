# Gần Nhau

Ứng dụng web nhỏ để **cặp đôi và gia đình xem vị trí của nhau trên cùng một bản đồ**, theo thời gian thực. Ví dụ: biết người kia đã về đến nhà chưa, hoặc cả nhà đi du lịch bằng nhiều xe mà không bị lạc nhau.

- Không cần tài khoản, không cần cài từ cửa hàng ứng dụng. Mở bằng Safari hoặc Chrome, có thể "Thêm vào màn hình chính" để dùng như một app.
- Một người tạo nhóm, gửi **link mời** (hoặc mã 8 ký tự), mọi người vào bằng tên.
- Bản đồ OpenStreetMap, ghim có tên và màu riêng từng người, khoảng cách, tốc độ, "x giây trước".
- **Báo khi ai đó đi quá xa** hoặc mất tín hiệu (tuỳ chọn, mặc định tắt).
- **Điểm hẹn**: ghim trạm dừng chân, quán ăn, khách sạn… cho cả nhóm, kèm nút chỉ đường (Google Maps, thêm Apple Maps trên iPhone).
- Mỗi người **tự bật hoặc tạm dừng** chia sẻ trên máy của mình. Vị trí chỉ nằm trong bộ nhớ máy chủ, **không lưu lịch sử di chuyển**.
- Tiếng Việt, giao diện sáng và tối, tự nối lại khi mất mạng.

Máy chủ viết bằng Node.js thuần, **không dùng thư viện ngoài** (không cần `npm install` để chạy).

---

## 1. Hai điều cần biết trước

**a) Đây là web app, nên vị trí chỉ cập nhật khi trang đang mở trên màn hình.**
iPhone và Android đều tạm dừng GPS của trang web khi bạn khoá màn hình hoặc chuyển sang ứng dụng khác. Với chuyến đi bằng ô tô: đặt điện thoại lên giá, cắm sạc, mở Gần Nhau (mục Cài đặt đã bật sẵn "Giữ màn hình sáng"). Nếu bạn cần chia sẻ ngầm liên tục khi tắt màn hình, ứng dụng gốc như **Chia sẻ vị trí của Google Maps**, **Find My** (iPhone) hoặc **Zalo** làm tốt hơn; web app không làm được việc đó.

**b) Định vị trên điện thoại chỉ hoạt động qua HTTPS.**
Mở bằng địa chỉ `http://` thường thì trình duyệt từ chối. Vì vậy phải đưa app lên một địa chỉ `https://` (mục 3 hoặc 4). Riêng `http://localhost:3000` trên chính máy tính của bạn thì được, dùng để xem thử giao diện.

---

## 2. Chạy thử trên máy tính (2 phút)

Cần Node.js 18 trở lên (kiểm tra: `node -v`; tải tại nodejs.org).

```bash
cd gan-nhau
npm start
```

Mở <http://localhost:3000>. Mở thêm một cửa sổ ẩn danh để giả làm người thứ hai.

Kiểm thử tự động (tuỳ chọn): `npm test` (22 kiểm thử cho máy chủ và hàm tiện ích).

---

## 3. Đưa lên mạng miễn phí bằng Render (khoảng 10 phút)

Render có gói **Free** cho web service và tự cấp HTTPS. Cách làm không cần gõ lệnh:

1. Tạo tài khoản ở **github.com** và **render.com** (đăng nhập Render bằng GitHub cho nhanh).
2. Trên GitHub: **New repository** → đặt tên `gan-nhau` → **Create repository** → bấm **uploading an existing file** → kéo thả **toàn bộ nội dung thư mục `gan-nhau`** (gồm `server.js`, `package.json`, thư mục `public`…) vào → **Commit changes**.
3. Trên Render: **New → Web Service** → chọn kho `gan-nhau` → điền:
   - **Region**: Singapore (gần Việt Nam nhất)
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: Free
   - (Tuỳ chọn) **Advanced → Health Check Path**: `/healthz`
4. Bấm **Create Web Service**, chờ trạng thái **Live**. Render cho bạn địa chỉ dạng `https://gan-nhau-xxxx.onrender.com`.
5. Mở địa chỉ đó trên điện thoại → **Tạo nhóm mới** → **Mời** → gửi link cho người thân.

Cách khác: dùng tệp `render.yaml` đi kèm (Render: **New → Blueprint**).

**Giới hạn của gói Free (theo tài liệu của Render):**
- Sau **15 phút không có truy cập**, dịch vụ tự "ngủ". Lần mở kế tiếp mất khoảng **1 phút** để thức dậy. Khi đang có người mở app và chia sẻ thì dịch vụ không ngủ.
- Mỗi lần ngủ, khởi động lại hoặc cập nhật, bộ nhớ bị xoá. App đã xử lý việc này: điện thoại **tự vào lại đúng nhóm cũ với cùng mã** sau vài giây, nhưng điểm hẹn đã đặt sẽ mất.
- Render có thể khởi động lại dịch vụ Free bất cứ lúc nào, và mỗi workspace (không gian làm việc) có 750 giờ chạy mỗi tháng; hết giờ thì các dịch vụ Free bị tạm ngưng tới tháng sau.
- Chưa xác nhận được Render hiện có đòi thẻ thanh toán khi tạo gói Free hay không. Nếu có và bạn không muốn dùng, xem mục 4 và 5.

Mẹo trước chuyến đi: mở link trước khi xuất phát vài phút để dịch vụ thức dậy.

---

## 4. Cách nhanh để thử ngay: chạy trên Mac + đường hầm Cloudflare

Không cần tài khoản, có HTTPS ngay. Mac phải đang bật và có mạng.

```bash
brew install cloudflared      # chỉ cần làm một lần
npm start                     # cửa sổ Terminal thứ nhất
cloudflared tunnel --url http://localhost:3000    # cửa sổ Terminal thứ hai
```

Terminal in ra một địa chỉ `https://….trycloudflare.com`. Mở địa chỉ đó trên điện thoại. Lưu ý:

- Địa chỉ **đổi mỗi lần chạy**, và Cloudflare mô tả Quick Tunnel là để thử nghiệm, không cam kết độ ổn định.
- Cách này **chưa được kiểm thử thực tế** trong lúc làm app. Riêng việc truyền dữ liệu thời gian thực thì app dùng POST streaming thay vì `EventSource`, vì có báo cáo cho thấy Quick Tunnel gom (buffer) các phản hồi GET kiểu đó.

---

## 5. Các cách triển khai khác

**Máy chủ riêng (VPS Ubuntu) + Caddy** (Caddy tự xin chứng chỉ HTTPS):

```bash
# Cài Node.js 18+ và Caddy, chép thư mục gan-nhau lên máy chủ, rồi:
cd gan-nhau && PORT=3000 node server.js          # nên chạy bằng systemd hoặc pm2
```

`/etc/caddy/Caddyfile`:

```
gannhau.ten-mien-cua-ban.com {
    reverse_proxy localhost:3000
}
```

**Docker:** `docker build -t gan-nhau .` rồi `docker run -p 3000:3000 gan-nhau`.

**Fly.io, Google Cloud Run, Railway…:** dùng được, nhưng phải chạy **đúng một bản (một instance)**, vì trạng thái nhóm nằm trong bộ nhớ. Ví dụ Cloud Run: `--max-instances=1`; Fly.io: một máy.

Đằng sau reverse proxy, máy chủ đọc địa chỉ IP thật từ `X-Forwarded-For` (để giới hạn tần suất đúng người). Nếu máy chủ nhận kết nối trực tiếp từ internet, đặt `TRUST_PROXY=0`.

---

## 6. Cách dùng

1. **Người đầu tiên** mở app, nhập tên, bấm **Tạo nhóm mới**, bấm **Bắt đầu chia sẻ** và chọn **Cho phép** khi điện thoại hỏi quyền vị trí.
2. Bấm **Mời** (hoặc chạm vào mã nhóm ở góc trên) và gửi link qua Zalo, Messenger, tin nhắn…
3. **Người được mời** mở link bằng Safari hoặc Chrome, nhập tên, bấm **Vào nhóm**, rồi cũng **Bắt đầu chia sẻ**. Cũng có thể nhập mã ở nút "Đã có mã nhóm? Nhập mã".
4. Trên bản đồ: ghim có tên mỗi người; chạm ghim để xem khoảng cách, tốc độ, độ chính xác và **chỉ đường**. Kéo ngăn phía dưới lên để xem danh sách. Ba nút bên phải: điểm hẹn, xem cả nhóm, về chỗ tôi.
5. **Cài đặt** (biểu tượng góc trên bên phải): tạm dừng chia sẻ, báo khi ai đó đi xa (300 m đến 5 km), giữ màn hình sáng, âm báo, đổi tên, rời nhóm.

**Mẹo cho chuyến đi bằng ô tô**
- Mỗi xe một người giữ app mở trên giá điện thoại, cắm sạc.
- Nếu dùng Google Maps dẫn đường trên cùng điện thoại, Gần Nhau nằm nền sẽ ngừng cập nhật. Hãy để một người khác trong xe giữ Gần Nhau, hoặc trên Android thử chia đôi màn hình.
- Đặt "Báo khi ai đó đi xa" ở 1 đến 2 km, và đặt **điểm hẹn** ở trạm dừng chân tiếp theo.
- Đi qua vùng sóng yếu: app tự nối lại khi có mạng.

**Mẹo cho iPhone:** nếu muốn dùng như app, hãy **Thêm vào màn hình chính trước**, rồi mới tạo hoặc vào nhóm bằng app đó. Safari và app trên màn hình chính **lưu dữ liệu riêng**, nên nếu vào nhóm ở Safari trước thì app trên màn hình chính sẽ không nhận ra bạn và bạn xuất hiện hai lần. Người trùng có thể bị xoá: chạm tên trong danh sách → **Xoá khỏi nhóm** (chỉ xoá được người đã ngắt kết nối hơn 3 phút).

**Zalo, Messenger, Facebook:** trình duyệt bên trong các ứng dụng này thường chặn định vị. Bấm dấu ba chấm và chọn "Mở bằng Safari/Chrome". App tự nhận ra và hiện cảnh báo.

---

## 7. Riêng tư và bảo mật

- **Chỉ chia sẻ khi người dùng đồng ý.** Trước lần xin quyền vị trí đầu tiên, app hiện hộp thoại giải thích. Trạng thái "Đang chia sẻ" luôn hiện trên màn hình. Cố ý **không có** chế độ theo dõi ngầm hay ẩn. Hãy chỉ dùng với người đã đồng ý.
- **Không lưu lịch sử.** Máy chủ chỉ giữ vị trí mới nhất trong bộ nhớ, không ghi ra đĩa và không ghi nhật ký yêu cầu. Nhóm tự xoá sau 24 giờ không hoạt động. (Nhà cung cấp hosting vẫn có thể thấy địa chỉ IP và địa chỉ trang được truy cập theo cách riêng của họ.)
- **Ai có link hoặc mã nhóm thì vào được nhóm** (tối đa 20 người) và thấy vị trí của mọi người. Mã gồm 8 ký tự từ bảng 31 ký tự (khoảng 8,5 × 10¹¹ tổ hợp) và mỗi địa chỉ IP bị chặn tạm thời sau 30 lần nhập sai trong 10 phút. Dù vậy, chỉ gửi link cho người tin cậy. Nếu link bị lộ: mọi người **Rời nhóm** và tạo nhóm mới.
- Mỗi người có một khoá bí mật sinh ngẫu nhiên và lưu trên máy mình. Máy chủ chỉ giữ **mã băm SHA-256** của khoá, nên người khác không thể giả mạo bạn.
- Máy chủ giới hạn kích thước yêu cầu, tần suất gửi vị trí, số nhóm, số người; kiểm tra mọi dữ liệu vào; đặt các tiêu đề bảo mật (CSP, `X-Content-Type-Options`, `Referrer-Policy`, chặn nhúng khung).

---

## 8. Cấu hình (biến môi trường, đều không bắt buộc)

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `PORT` | 3000 | Cổng lắng nghe (Render tự đặt) |
| `HOST` | 0.0.0.0 | Địa chỉ lắng nghe |
| `GROUP_TTL_HOURS` | 24 | Số giờ giữ nhóm khi không ai hoạt động |
| `MAX_GROUPS` | 300 | Số nhóm tối đa cùng lúc |
| `MAX_MEMBERS` | 20 | Số người tối đa mỗi nhóm |
| `CREATE_PER_HOUR` | 20 | Số lần tạo nhóm tối đa mỗi giờ cho mỗi IP |
| `GHOST_AFTER_SECONDS` | 180 | Vắng mặt bao lâu thì được xoá khỏi nhóm |
| `TRUST_PROXY` | bật | Đặt `0` nếu không đứng sau proxy |

---

## 9. Bản đồ và giấy phép

- Ô bản đồ lấy từ máy chủ công cộng của **OpenStreetMap**, đã kèm dòng ghi công bắt buộc. Máy chủ này dành cho mức dùng nhẹ, hợp với một gia đình; xem chính sách tại <https://operations.osmfoundation.org/policies/tiles/>. Nếu cần nhiều hơn, dùng nhà cung cấp ô bản đồ khác: đổi `OSM_URL` và dòng ghi công trong `public/app.js`, đồng thời thêm tên miền đó vào `img-src` của CSP trong `server.js`.
- Mã nguồn: MIT (xem `LICENSE`). Kèm theo: Leaflet 1.9.4 (BSD-2-Clause), phông Be Vietnam Pro (SIL OFL 1.1), dữ liệu bản đồ © những người đóng góp OpenStreetMap (ODbL).

## 10. Cấu trúc thư mục

```
server.js               máy chủ (Node.js, không thư viện ngoài)
public/index.html       trang duy nhất
public/app.js           toàn bộ logic phía trình duyệt
public/util.js          hàm thuần: khoảng cách, định dạng, màu (có kiểm thử)
public/style.css        giao diện
public/sw.js            service worker tối giản để cài như app (không lưu đệm gì)
public/manifest.webmanifest, public/icons/   thông tin cài đặt và biểu tượng
public/vendor/leaflet/  thư viện bản đồ
public/fonts/           phông Be Vietnam Pro
test/                   kiểm thử tự động (npm test)
render.yaml, Dockerfile cấu hình triển khai
```
