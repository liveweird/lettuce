# The runner requires a version- and digest-pinned official Playwright image.
ARG PLAYWRIGHT_IMAGE
FROM ${PLAYWRIGHT_IMAGE}
RUN node -e 'if (Number(process.versions.node.split(".")[0]) < 24) { throw new Error("Visual runner requires Node >=24"); } console.log("Visual Node runtime:", process.version)'
WORKDIR /workspace
COPY web/package.json web/package-lock.json ./web/
RUN cd web && npm ci --legacy-peer-deps
COPY e2e/package.json e2e/package-lock.json ./e2e/
RUN cd e2e && npm ci
COPY web/src/ ./web/src/
COPY web/public/ ./web/public/
COPY web/index.html web/postcss.config.cjs web/tsconfig.json web/tsconfig.app.json web/tsconfig.node.json ./web/
COPY e2e/sessions.ts ./e2e/sessions.ts
COPY e2e/visual/ ./e2e/visual/
WORKDIR /workspace/e2e
ENV CI=1
ENV VISUAL_CANONICAL=1
ENTRYPOINT ["./node_modules/.bin/playwright", "test", "--config", "visual/playwright.config.ts"]
