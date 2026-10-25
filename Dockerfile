# Gần Nhau — chạy bằng Docker:
#   docker build -t gan-nhau .
#   docker run -p 3000:3000 gan-nhau
# Lưu ý: trạng thái nhóm nằm trong bộ nhớ nên chỉ chạy MỘT bản (một container) cho mỗi địa chỉ.
FROM node:22-alpine
WORKDIR /app
COPY package.json server.js ./
COPY public ./public
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
USER node
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s CMD wget -qO- "http://127.0.0.1:${PORT}/healthz" || exit 1
CMD ["node", "server.js"]
