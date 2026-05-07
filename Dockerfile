FROM node:20-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY src ./src
COPY public ./public

ENV HTTP_HOST=0.0.0.0 \
    HTTP_PORT=9001 \
    SMTP_HOST=0.0.0.0 \
    SMTP_PORT=25 \
    MAIL_PROVIDER=mailtm \
    MAIL_DOMAINS=example.test \
    MAIL_TTL_MINUTES=60 \
    MAX_PER_INBOX=50 \
    BASE_PATH=

EXPOSE 9001 25

CMD ["node", "src/server.js"]
