FROM node:20.19-alpine

WORKDIR /app

COPY backend/package.json backend/package-lock.json ./backend/
RUN cd backend && npm ci --omit=dev

COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN cd frontend && npm ci

COPY backend ./backend
COPY frontend ./frontend
RUN cd frontend && npm run build

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

WORKDIR /app/backend
CMD ["node", "server.js"]
