# 1. Dùng image Node.js chính thức
FROM node:20

# 2. Set thư mục làm việc
WORKDIR /usr/src/app

# 3. Copy package để cài trước (cache)
COPY package*.json ./

# 4. Cài đặt các package
RUN npm install

# 5. Copy toàn bộ code vào container
COPY . .

# 6. Set biến môi trường nếu cần
ENV NODE_ENV=production

# 7. Cổng ứng dụng chạy
EXPOSE 3000

# 8. Lệnh khởi động
CMD ["node", "src/server.js"]
