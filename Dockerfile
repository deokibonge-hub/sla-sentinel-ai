FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends tesseract-ocr imagemagick poppler-utils && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --chown=node:node . .
RUN mkdir -p /app/data && chown -R node:node /app/data
ENV PORT=3000 DATA_DIR=/app/data NODE_ENV=production
EXPOSE 3000
USER node
CMD ["node", "--no-warnings", "server/index.js"]
