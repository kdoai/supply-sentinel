FROM node:20-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4173

COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY data ./data
COPY src ./src
COPY web ./web
COPY host.json ./host.json

EXPOSE 4173

CMD ["node", "src/serve.mjs"]
