FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --chown=node:node lib ./lib
COPY --chown=node:node web ./web
COPY --chown=node:node dist ./dist
COPY --chown=node:node server.mjs ./
COPY --chown=node:node tools/build-editor.mjs ./tools/build-editor.mjs
RUN node tools/build-editor.mjs
RUN mkdir .local && chown node:node .local
USER node
# This revision re-reads DEV2 designations from the operator record (lib/target-designations.mjs);
# deploy/prod-update.py designates without a restart only for a container carrying this label.
LABEL org.elma-wiki.dev2-designations=file-v1
EXPOSE 43171
CMD ["node", "server.mjs"]
