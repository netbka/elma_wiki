FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --chown=node:node lib ./lib
COPY --chown=node:node web ./web
COPY --chown=node:node dist ./dist
COPY --chown=node:node server.mjs ./
RUN mkdir .local && chown node:node .local
USER node
EXPOSE 43171
CMD ["node", "server.mjs"]
