FROM node:20.11.1

WORKDIR /app

COPY package*.json ./
RUN npm install --legacy-peer-deps

COPY . .

ENV PORT=5000

RUN npx prisma generate

CMD ["node", "src/index.js"]
