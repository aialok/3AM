FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev || true
COPY . .
CMD ["node", "src/index.js"]
